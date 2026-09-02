export interface IDialogsMessage {
    id: number, //PK
    text: string,
    date: string,
    is_read: boolean,
    dialog_id: number, //FK
    sender_id: number, //FK
    reply_message_id: number //FK
}