export interface IPublication {
    id: number, //PK
    text: string,
    file_id: number,
    date: string,
    user_id: number //FK,
}