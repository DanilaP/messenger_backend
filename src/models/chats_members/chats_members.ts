export interface IChatMember {
    id: number, //PK
    chat_id: string, //FK
    user_id: string //FK
}