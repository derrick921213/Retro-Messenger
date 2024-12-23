import React, { useContext, useState, useEffect, useCallback } from 'react';
import { UserContext } from '../../App'; // 引入全域的 UserContext
import UserList from './UserList'; // 用戶列表元件
import ChatArea from './ChatArea'; // 聊天區域元件
import UserProfile from './UserProfile'; // 用戶頭像與登出元件
import { Socket } from 'socket.io-client';

// 聊天訊息的類型定義
type ChatMessage = {
    from: string; // 發送訊息者的 username
    content: string; // 訊息內容
    time: string; // 訊息的傳送時間
    read: boolean; // 訊息是否已讀
};

// 用戶資料類型定義
type User = {
    username: string; // 用戶名
    isOnline: boolean; // 是否在線狀態
    roomId: string; // 房間 ID
    unreadMessages: number; // 未讀訊息數量
};

const ChatRoom: React.FC<{ socket: typeof Socket | null }> = ({ socket }) => {    
    const userContext = useContext(UserContext);
    const username = String(userContext?.username) || "testUser123"; // 如果 Context 為空，使用測試用戶
    
    // 狀態管理
    const [selectedUser, setSelectedUser] = useState<string | null>(null); // 當前選中的聊天對象
    const [messages, setMessages] = useState<{ [key: string]: ChatMessage[] }>({}); // 所有聊天訊息的集合
    const [users, setUsers] = useState<User[]>([]); // 用戶清單
    const [roomId, setRoomId] = useState<string>(''); // 當前房間 ID

    useEffect(() => {
        if (socket) {
            socket.emit('authenticate', { username: username });

            socket.on('authenticated', (response: any) => {
                if (response.status === 'success') {
                    console.log('Authentication successful');
                } else {
                    console.error('Authentication failed');
                }
            });

            socket.off('authenticated');
        } else {
            console.warn("Socket connection is not available.");
        }
    });

    const loadRooms = async () => {
        try {
            const response = await fetch(`http://127.0.0.1:12345/room-list?username=${username}`);
            if (response.ok) {
                const rooms = await response.json();
                setUsers(rooms.map((room: { room_id: string; room_name: string; isOnline: boolean; unreadMessages: number}) => ({
                    username: room.room_name,
                    isOnline: room.isOnline,
                    roomId: room.room_id,
                    unreadMessages: room.unreadMessages
                })));
            } else {
                console.error(`Failed to load rooms, status: ${response.status}`);
                const error = await response.json();
                console.error(error);
            }
        } catch (error) {
            console.error("Error fetching room list:", error);
        }
    };

    useEffect(() => {
        loadRooms();

        if (socket) {
            socket.on('room_list_update', (roomData: any) => {
                console.log("Received room update:", roomData);
                
                loadRooms();
            });

            return () => {
                socket.off('room_update');
            };
        }
    }, []);

    // 當選擇用戶時，設置對應的 roomId
    const handleSelectUser = (username: string) => {
        
        setSelectedUser(username);  // 設置 selectedUser 為選中的 username
        // 根據選中的 username 設置對應的 roomId
        const selectedRoom = users.find(user => user.username === username);
        if (selectedRoom) {
            setRoomId(selectedRoom.roomId);  // 使用該 username 的 roomId
        }
    };      

    const sendMessage = useCallback(async (message: ChatMessage) => {
        console.log("selectedUser:", selectedUser);
        console.log("roomId:", roomId); // 確保 roomId 已經正確設置
    
        if (roomId) { // 這裡檢查 roomId 是否存在
            const newMessage = {
                from: username,
                content: message.content,
                time: new Date().toLocaleString(),
                read: false,
            };
            
            // 更新訊息狀態，顯示發送的訊息
            setMessages((prev) => {
                const updatedMessages = {
                    ...prev,
                    [roomId]: [...(prev[roomId] || []), newMessage], // 根據 roomId 更新訊息
                };
                return updatedMessages;
            });
    
            try {
                const response = await fetch("http://127.0.0.1:12345/send-message", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                    },
                    body: JSON.stringify({
                        username,
                        to_room_id: roomId, // 使用正確的 roomId
                        message: message.content,
                    }),
                });
    
                console.log({
                    username,
                    to_room_id: roomId,
                    message: message.content
                });
    
                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Failed to send message');
                }
            } catch (error) {
                console.error("Error sending message:", error);
            } finally {
                if (socket) {
                    socket.emit('history_update', { room_id: roomId, username: username })
                    socket.emit('room_list_update');
                }
            }
        }
    }, [selectedUser, roomId, username]);

    const loadMessageHistory = async (roomId: string, username: string) => {
        try {
            const response = await fetch(`http://127.0.0.1:12345/message-history?room_id=${roomId}&username=${username}`);
            if (response.ok) {
                const data = await response.json();
                if (data.message === "no_messages") {
                    console.log("No messages found for this room.");
                    setMessages((prev) => ({
                        ...prev,
                        [roomId]: [] // 設置為空陣列表示沒有訊息
                    }));
                } else if (Array.isArray(data)) {
                    setMessages((prev) => ({
                        ...prev,
                        [roomId]: data.map((msg: any) => ({
                            from: msg.from_user,
                            content: msg.message,
                            time: new Date(msg.date).toLocaleString(),
                            read: msg.status
                        }))
                    }));
                } else {
                    console.error("Unexpected data format:", data);
                }
            } else {
                console.error("Failed to load message history");
            }
        } catch (error) {
            console.error("Error fetching message history:", error);
        }
    };

    useEffect(() => {
        if (socket && roomId && username) {
            socket.emit('history_update', { room_id: roomId, username: username })

            socket.on('history_update', () => {
                console.log("Recieved update request");
                socket.emit('mark_read', { room_id: roomId, username: username });
                socket.emit('room_list_update');

                loadMessageHistory(roomId, username);
            });
    
            return () => {
                socket.off('history_update');
            };
        } else {
            console.warn("Missing room ID or username here.");
        }
    }, [socket, roomId, username]);

    // 用戶登出處理
    const handleLogout = async () => {
        try {
            const response = await fetch("http://127.0.0.1:12345/logout", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ username }), // 發送 username 到後端 API
            });

            if (response.ok) {
                const data = await response.json();
                console.log(data.message); // 顯示登出成功訊息
            } else {
                const errorData = await response.json();
                console.error(errorData.error || "登出失敗");
            }
        } catch (error) {
            console.error("Error logging out:", error);
        }
    };

    return (
        <div className="flex h-screen">
            {/* 用戶列表區域 */}
            <div className="w-64 min-w-[150px] bg-gray-100 flex flex-col h-full flex-shrink-0">
                {/* 可滾動的用戶列表區域 */}
                <div className="overflow-y-auto flex-grow p-4">
                    <UserList 
                        users={users} 
                        onSelectUser={handleSelectUser}
                        selectedUser={selectedUser}
                        className="space-y-2"
                    />
                </div>
                {/* 固定在底部的 UserProfile */}
                <div className="bg-gray-100 p-3">
                    <UserProfile 
                        username={username}
                        onLogout={handleLogout}
                        users={users}
                    />
                </div>
            </div>

            {/* 聊天區域 */}
            <div className="flex-grow flex flex-col">
                {selectedUser && (
                    <ChatArea
                        socket={socket}
                        selectedUser={selectedUser}
                        username={username}
                        messages={messages[roomId] || []} // 使用 roomId 來獲取正確的訊息
                        onSendMessage={sendMessage}
                        setUserList={setUsers} // 將 setUserList 函數作為 prop 傳遞
                        userList={users}
                        roomId={roomId} // 傳遞 roomId
                    />
                )}
            </div>
        </div>
    );
};

export default ChatRoom;