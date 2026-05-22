export interface IChatMessage {
    id: number,
    text: string,
    date: string,
    chat_id: number,
    sender_id: number,
    is_read: boolean,
    replay_message_id: number
}