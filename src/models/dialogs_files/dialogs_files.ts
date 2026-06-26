export interface IFile {
    id: number, //PK
    name: string,
    url: string,
    size: number,
    type: string,
    message_id: number //FK
}