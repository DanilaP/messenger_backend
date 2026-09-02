export interface IChatFile {
    id: number, //PK
    name: string,
    url: string,
    type: string,
    size: number,
    message_id: number //FK
}