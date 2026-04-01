export interface IDialogsMessage {
    id: number,
    text: string,
    date: string,
    is_read: boolean,
    dialog_id: number, //FK
    sender_id: number //FK
}