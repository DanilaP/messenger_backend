export interface IFile {
    id: number,
    name: string,
    url: string,
    size: number,
    type: string,
    message_id: number //FK
}