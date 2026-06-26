export interface IChatMessage {
    id: number, //PK
    text: string,
    date: string,
    chat_id: number,
    sender_id: number,
    is_read: boolean,
    replay_message_id: number //FK
}