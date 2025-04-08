// DOM이 로드된 후 스크립트 실행
document.addEventListener('DOMContentLoaded', () => {

    // DOM 요소는 DOM 로드 후에 가져옵니다.
    const messagesDiv = document.getElementById('messages');
    const messageForm = document.getElementById('message-form');
    const nicknameInput = document.getElementById('nickname-input');
    const messageInput = document.getElementById('message-input');
    const sendButton = document.getElementById('send-button');
    const userListUl = document.getElementById('user-list');
    // theme selector 추가
    const themeSelector = document.getElementById('theme-selector');
    const themeStyleLink = document.getElementById('theme-style'); // <<< 테마 CSS 링크 요소 가져오기

    // ... (userListUl, themeStyleLink null 체크 로직 추가 권장) ...
    if (!themeStyleLink) {
        console.error("심각한 오류: 테마 CSS 링크(id='theme-style')를 찾을 수 없습니다!");
        return;
    }

    // userListUl 요소를 찾았는지 다시 한번 확인 (DOM 로드 후에도 못 찾으면 HTML 문제)
    if (!userListUl) {
        console.error("심각한 오류: HTML에서 id='user-list'인 <ul> 요소를 찾을 수 없습니다!");
        alert("채팅 UI 초기화 실패! HTML 코드를 확인하세요.");
        return; // 초기화 중단
    }

    let websocket = null;
    let nickname = ''; // 사용자가 입력하는 닉네임 (임시 저장용)
    let currentNickname = null; // 서버에서 확정된 닉네임

    // --- WebSocket 서버 주소 ---
    // const WS_URL = 'ws://localhost:8080'; // 로컬 테스트용
    const WS_URL = window.location.origin.replace('http', 'ws');
    
    // --- 페이지 로드 시 테마 적용 ---
    const savedTheme = localStorage.getItem('chatTheme');
    if (savedTheme && savedTheme !== themeStyleLink.getAttribute('href')) { // 저장된 테마가 있고 현재 링크와 다르면
        console.log(`Loading saved theme: ${savedTheme}`);
        themeStyleLink.setAttribute('href', savedTheme); // link 태그의 href 속성 변경
    }

    // --- 테마 변경 로직 (새로고침 없음) ---
    if (themeSelector) {
        themeSelector.addEventListener('click', (event) => {
            if (event.target.tagName === 'BUTTON' && event.target.dataset.theme) {
                const selectedTheme = event.target.dataset.theme;
                const currentThemeHref = themeStyleLink.getAttribute('href');

                if (selectedTheme !== currentThemeHref) {
                    console.log(`Changing theme to: ${selectedTheme}`);
                    // <<< href 속성만 변경 (페이지 새로고침 없음)
                    themeStyleLink.setAttribute('href', selectedTheme);
                    // localStorage에 선택한 테마 저장
                    localStorage.setItem('chatTheme', selectedTheme);
                } else {
                    console.log("이미 적용된 테마입니다.");
                }
            }
        });
    } else {
        console.warn("테마 선택 UI(id='theme-selector')를 찾을 수 없습니다.");
    }

// ----------------------------------------------------------------------------------
    function connectWebSocket() {
        websocket = new WebSocket(WS_URL);

        websocket.onopen = () => {
            console.log('WebSocket 연결 성공');
            addSystemMessage('서버에 연결되었습니다. 닉네임을 입력하고 첫 메시지를 보내면 채팅에 참여합니다.');
            messageInput.disabled = false;
            sendButton.disabled = false;
            nicknameInput.disabled = false;
            nicknameInput.focus();
        };

        websocket.onmessage = (event) => {
            console.log('Raw message received:', event.data);
            try {
                const messageData = JSON.parse(event.data);
                console.log('Parsed message received:', messageData);

                switch (messageData.type) {
                    case 'message':
                        displayMessage(
                            messageData.nickname,
                            messageData.text,
                            messageData.timestamp,
                            // <<< 중요: currentNickname이 설정되었는지 확인 후 비교
                            !!currentNickname && messageData.nickname === currentNickname
                        );
                        
                        // 내가 보낸 메시지가 아니라면 알림 시작
                        if (!(!!currentNickname && messageData.nickname === currentNickname)) {
                            startNotification(messageData.nickname);
                        }
                        break;
                    case 'user_list':
                        console.log('Received user list data:', messageData.users);
                        updateUserList(messageData.users);
                        break;
                    case 'user_join':
                    case 'user_leave':
                    case 'system':
                        addSystemMessage(messageData.text);
                        break;
                    default:
                        console.warn('알 수 없는 메시지 타입:', messageData.type);
                }

            } catch (error) {
                console.error('메시지 처리 오류 발생! Raw data:', event.data, 'Error:', error);
                addSystemMessage('오류: 메시지 처리 중 문제가 발생했습니다.');
            }
        };

        websocket.onerror = (error) => {
            console.error('WebSocket 오류:', error);
            addSystemMessage('연결 오류가 발생했습니다. 새로고침 해보세요.');
            disableInput();
            updateUserList([]); // 오류 시 사용자 목록 비움
        };

        websocket.onclose = (event) => {
            console.log('WebSocket 연결 종료:', event.code, event.reason);
            if (!event.reason?.includes('사용 중인 닉네임')) {
                 addSystemMessage(`연결이 종료되었습니다. (${event.reason || '이유 없음'}) 새로고침하여 다시 연결하세요.`);
            }
            disableInput();
            updateUserList([]); // 연결 종료 시 사용자 목록 비움
            currentNickname = null; // 현재 닉네임 초기화
            websocket = null;
        };
    }

    function disableInput() {
        messageInput.disabled = true;
        sendButton.disabled = true;
        nicknameInput.disabled = true;
    }

    function addSystemMessage(text) {
        const div = document.createElement('div');
        div.classList.add('message', 'system');
        div.textContent = text;
        messagesDiv.appendChild(div);
        scrollToBottom();
    }

    function displayMessage(senderNickname, text, timestamp, isSentByMe) {
        const div = document.createElement('div');
        // <<< isSentByMe 값에 따라 클래스 분기
        div.classList.add('message', isSentByMe ? 'sent' : 'received');
        console.log(`Displaying message: Nick=${senderNickname}, isSentByMe=${isSentByMe}`); // isSentByMe 값 확인 로그

        if (!isSentByMe) {
            const nickSpan = document.createElement('span');
            nickSpan.classList.add('nickname');
            nickSpan.textContent = senderNickname;
            div.appendChild(nickSpan);
        }

        const textSpan = document.createElement('span');
        textSpan.textContent = text;
        div.appendChild(textSpan);

        if (timestamp) {
            const timeSpan = document.createElement('span');
            timeSpan.classList.add('timestamp');
            timeSpan.textContent = timestamp;
            div.appendChild(timeSpan);
        }

        messagesDiv.appendChild(div);
        scrollToBottom();
    }

    function sendMessage() {
        nickname = nicknameInput.value.trim(); // 사용자가 입력한 닉네임 사용
        const messageText = messageInput.value.trim();

        if (!nickname) {
            alert('닉네임을 입력해주세요.');
            nicknameInput.focus();
            return;
        }
        if (!messageText) {
            return;
        }

        if (websocket && websocket.readyState === WebSocket.OPEN) {
            const messageData = {
                type: 'message',
                nickname: nickname,
                text: messageText
            };
            websocket.send(JSON.stringify(messageData));

            messageInput.value = '';
            messageInput.focus();

        } else {
            addSystemMessage('연결되지 않았습니다. 메시지를 보낼 수 없습니다.');
        }
    }

    function scrollToBottom() {
        // messagesDiv가 null이 아닌지 확인 (안전 코드)
        if (messagesDiv) {
            messagesDiv.scrollTop = messagesDiv.scrollHeight;
        }
    }

    function updateUserList(users) {
        console.log('updateUserList called with users:', users);
        // userListUl이 null이면 함수 종료 (초기화 시 오류 체크 했으므로 이론상 발생 안 함)
        if (!userListUl) {
            console.error("updateUserList: Cannot find user list UL element!");
            return;
        }

        const enteredNickname = nicknameInput.value.trim();
        // <<< currentNickname 설정 및 입력창 비활성화 로직
        if (!currentNickname && enteredNickname && users.includes(enteredNickname)) {
            currentNickname = enteredNickname;
            nicknameInput.disabled = true;
            console.log(`Nickname confirmed and input disabled: ${currentNickname}`);
        }

        userListUl.innerHTML = '';
        if (users && Array.isArray(users) && users.length > 0) {
            users.sort((a, b) => {
                if (a === currentNickname) return -1;
                if (b === currentNickname) return 1;
                return a.localeCompare(b);
            });

            users.forEach(user => {
                const li = document.createElement('li');
                li.textContent = user;
                if (user === currentNickname) {
                     li.style.fontWeight = 'bold';
                     li.textContent += ' (나)';
                }
                userListUl.appendChild(li);
            });
            console.log('User list updated in UI.');
        } else {
            const li = document.createElement('li');
            li.textContent = '참여자 없음';
            li.style.fontStyle = 'italic';
            userListUl.appendChild(li);
            console.log('User list is empty, showing "참여자 없음".');
        }
    }

    // 폼 이벤트 리스너 추가
    messageForm.addEventListener('submit', (e) => {
        e.preventDefault();
        sendMessage();
    });

    // 초기 WebSocket 연결 시도
    connectWebSocket();

    // --- 알림 기능 관련 변수 ---
    let originalTitle = document.title; // 원래 페이지 제목 저장
    let notificationInterval = null; // 제목 깜박임 인터벌
    let isPageVisible = true; // 페이지 가시성 상태
    let unreadMessages = 0; // 읽지 않은 메시지 수

    // 페이지 가시성 변경 감지
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            // 페이지가 다시 보이면 알림 초기화
            isPageVisible = true;
            resetNotification();
        } else {
            // 페이지가 숨겨지면 상태 업데이트
            isPageVisible = false;
        }
    });

    // 새 메시지 알림 시작
    function startNotification(senderNickname) {
        // 페이지가 보이지 않을 때만 알림
        if (!isPageVisible) {
            unreadMessages++;
            
            // 이미 알림이 활성화되어 있지 않다면 시작
            if (!notificationInterval) {
                notificationInterval = setInterval(() => {
                    // 제목 번갈아 변경하기
                    if (document.title === originalTitle) {
                        document.title = `(${unreadMessages}) 새 메시지 - ${senderNickname}`;
                    } else {
                        document.title = originalTitle;
                    }
                }, 1000); // 1초마다 깜박임
            } else {
                // 알림이 이미 활성화된 경우 제목만 업데이트
                document.title = `(${unreadMessages}) 새 메시지 - ${senderNickname}`;
            }
        }
    }

    // 알림 초기화
    function resetNotification() {
        if (notificationInterval) {
            clearInterval(notificationInterval);
            notificationInterval = null;
        }
        document.title = originalTitle;
        unreadMessages = 0;
    }

}); // <<< DOMContentLoaded 리스너 끝