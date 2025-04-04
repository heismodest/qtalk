const WebSocket = require('ws');
const express = require('express');
const path = require('path');
const http = require('http');

// Express 앱 생성
const app = express();

// 정적 파일 제공 설정
app.use(express.static(path.join(__dirname)));

// 모든 경로에 대해 index.html 반환
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// HTTP 서버 생성
const PORT = process.env.PORT || 8080;
const server = http.createServer(app);

// WebSocket 서버를 HTTP 서버에 연결
const wss = new WebSocket.Server({ server });

// 기존 WebSocket 코드...
// 연결된 클라이언트를 저장할 Map
const clients = new Map();
console.log('WebSocket 서버 시작 (포트: ' + PORT + ')');

wss.on('connection', (ws) => {
    console.log('클라이언트 연결됨');
    // 처음 연결 시에는 닉네임을 모르므로, 일단 ws 객체만 추가 (나중에 닉네임 설정)
    // clients.set(ws, null); // Map에는 닉네임과 함께 추가할 것이므로 이 줄은 불필요

    // 클라이언트로부터 메시지 수신 시
    ws.on('message', (message) => {
        let parsedMessage;
        try {
            parsedMessage = JSON.parse(message.toString());
            console.log('메시지 수신:', parsedMessage);

            // 메시지 타입에 따라 처리
            if (parsedMessage.type === 'message') {
                const nickname = parsedMessage.nickname;
                const text = parsedMessage.text;

                // 이 클라이언트의 닉네임이 아직 Map에 없다면(첫 메시지), 설정하고 입장 처리
                if (!clients.has(ws)) {
                    // 닉네임 중복 체크 (간단하게) - 실제로는 더 견고해야 함
                    let isDuplicate = false;
                    for (const existingNickname of clients.values()) {
                        if (existingNickname === nickname) {
                            isDuplicate = true;
                            break;
                        }
                    }
                    if (isDuplicate) {
                        ws.send(JSON.stringify({ type: 'system', text: `오류: 닉네임 "${nickname}"은(는) 이미 사용 중입니다. 다른 닉네임을 사용해주세요.` }));
                        ws.close(); // 중복 시 연결 종료
                        return;
                    }

                    clients.set(ws, nickname); // Map에 클라이언트와 닉네임 저장
                    console.log(`사용자 등록: ${nickname}`);

                    // 입장 알림 브로드캐스트 (본인 제외)
                    broadcast(JSON.stringify({
                        type: 'user_join',
                        text: `${nickname}님이 입장하셨습니다.`
                    }), ws); // <<< 본인 제외 옵션 추가

                    // 사용자 목록 업데이트 브로드캐스트 (모든 클라이언트에게)
                    sendUserList();

                } else if (clients.get(ws) !== nickname) {
                     // 중간에 닉네임을 바꾸려고 하는 경우 (여기서는 허용하지 않음)
                     ws.send(JSON.stringify({ type: 'system', text: '오류: 닉네임은 변경할 수 없습니다.' }));
                     return;
                }

                // 메시지에 타임스탬프 추가하여 브로드캐스트 (모든 클라이언트에게)
                const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit'}); // HH:MM:SS 형식
                broadcast(JSON.stringify({
                    type: 'message',
                    nickname: nickname,
                    text: text,
                    timestamp: timestamp // <<< 타임스탬프 추가
                })); // <<< 모든 사용자에게 보냄

            }
            // 다른 타입의 메시지 처리 (필요 시 추가)

        } catch (error) {
            console.error('잘못된 메시지 형식 또는 처리 오류:', message.toString(), error);
        }
    });

// 서버 시작
    server.listen(PORT, () => {
    console.log(`HTTP 서버가 포트 ${PORT}에서 실행 중입니다.`);
    });

    // 클라이언트 연결 종료 시
    ws.on('close', () => {
        const nickname = clients.get(ws); // <<< 연결 종료 전 닉네임 가져오기
        console.log(`클라이언트 연결 종료됨: ${nickname || '(닉네임 미설정)'}`);

        if (nickname) { // 닉네임이 설정된 사용자였다면
            clients.delete(ws); // Map에서 제거
            // 퇴장 알림 브로드캐스트 (남은 클라이언트에게)
            broadcast(JSON.stringify({
                type: 'user_leave',
                text: `${nickname}님이 퇴장하셨습니다.`
            })); // <<< 모든 남은 사용자에게 보냄
            // 사용자 목록 업데이트 브로드캐스트 (남은 클라이언트에게)
            sendUserList();
        } else {
            // 닉네임 설정 전에 연결이 끊긴 경우 Map에서 제거할 필요 없음
            clients.delete(ws); // 혹시 모를 경우 대비
        }
    });

    // 에러 발생 시
    ws.on('error', (error) => {
        const nickname = clients.get(ws);
        console.error(`WebSocket 오류 발생 (${nickname || 'Unknown'}):`, error);
        if (clients.has(ws)) {
             clients.delete(ws);
             if(nickname) { // 닉네임이 있었다면 퇴장처리 및 목록갱신
                broadcast(JSON.stringify({
                    type: 'user_leave',
                    text: `${nickname}님의 연결 오류로 퇴장 처리되었습니다.`
                }));
                sendUserList();
             }
        }
    });

    // 새로운 클라이언트에게 간단한 환영 메시지 (선택적)
    // ws.send(JSON.stringify({ type: 'system', text: '채팅 서버에 오신 것을 환영합니다! 닉네임 입력 후 첫 메시지를 보내면 입장이 완료됩니다.' }));
});

// 모든 클라이언트에게 메시지 전송 (senderWs를 지정하면 해당 클라이언트 제외)
function broadcast(data, senderWs = null) {
    clients.forEach((nickname, client) => { // <<< Map 순회 방식 변경
        if (client !== senderWs && client.readyState === WebSocket.OPEN) {
            client.send(data, (err) => {
                if (err) {
                    console.error(`메시지 전송 실패 (${nickname}):`, err);
                    // 문제가 있는 클라이언트는 제거하고 목록 갱신
                    const failedNickname = clients.get(client);
                    clients.delete(client);
                    if (failedNickname){
                        broadcast(JSON.stringify({ type: 'system', text: `${failedNickname}님과의 연결 문제 발생.`}));
                        sendUserList();
                    }
                }
            });
        } else if (senderWs === null && client.readyState === WebSocket.OPEN) {
            // senderWs가 null이면 모든 클라이언트에게 보냄 (메시지, 사용자 목록 등)
             client.send(data, (err) => {
                 if (err) {
                    console.error(`메시지 전송 실패 (${nickname}):`, err);
                    const failedNickname = clients.get(client);
                    clients.delete(client);
                     if (failedNickname){
                        broadcast(JSON.stringify({ type: 'system', text: `${failedNickname}님과의 연결 문제 발생.`}));
                        sendUserList();
                     }
                 }
             });
        }
    });
}

// 모든 클라이언트에게 현재 사용자 목록 전송
function sendUserList() {
    const userList = Array.from(clients.values()); // <<< Map의 값(닉네임)들로 배열 생성
    console.log("Sending user list:", userList);
    broadcast(JSON.stringify({
        type: 'user_list',
        users: userList
    })); // <<< 모든 클라이언트에게 전송
}