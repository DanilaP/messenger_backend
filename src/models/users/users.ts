export interface IUser {
    id: number,
    login: string,
    password?: string,
    name: string,
    surname: string,
    lastname: string | null,
    date_of_birth?: string,
    username: string,
    status: null,
    avatar: string
}