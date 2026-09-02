export interface IPublicationFile {
    id: number, //PK
    url: string,
    size: number,
    type: string,
    publication_id: number //FK
}