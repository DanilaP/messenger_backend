export interface IPublication {
    id: number, //PK
    text: string,
    date: string,
    user_id: number //FK,
}