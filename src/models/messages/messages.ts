export interface IMessage {
    id: number,
    text: string,
    date: string,
    dialog_id: number, //FK
    sender_id: number //FK
}