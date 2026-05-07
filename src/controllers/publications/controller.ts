import { Request, Response } from 'express';
import { db } from '../../../db';
import userHelpers from '../../helpers/user-helpers';
import moment from 'moment';
import fsHelpers from '../../helpers/fs-helpers';

class PublicationsController {
    static async getPublications(req: Request, res: Response) {
        try {
            const userId = Number(req.query.userId);
            const userPublications = await db.query(
                `
                    select 
                        publications.id,
                        user_id as "userId", 
                        text,
                        date,
                        json_build_object('url', url, 'size', size, 'type', type) as file
                    from publications
                    join publications_files on publications_files.publication_id = publications.id 
                    where user_id = $1    
                `,
                [userId]
            );
            res.status(200).json({ 
                message: "Успешное получение публикаций пользователя",
                publicaions: userPublications.rows
            });
            return;
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при получении публикаций" });
            console.log(error);
            return;
        }
    }
    static async createPublication(req: Request, res: Response) {
        const client = await db.getClient();

        try {
            const userId = userHelpers.getUserIdFromToken(req);
            const { text } = req.body;

            if (req.files && Array.isArray(req.files.files)) {
                res.status(400).json({ 
                    message: "Ошибка при создании публикации. Выбрано более 1 файла" 
                });
                return;
            }
            else if (req.files) {
                const publicationInfo = {
                    file: (await fsHelpers.uploadFiles(req.files, "/publications")).filelist[0]
                }
                const createdPublicationInfo = await db.query(
                    `INSERT INTO publications (user_id, text, date) 
                    VALUES ($1, $2, $3) 
                    RETURNING id, user_id as "userId", text, date`,
                    [
                        userId, 
                        text, 
                        moment().format('YYYY-MM-DD')
                    ]
                );
                if (createdPublicationInfo.rows.length === 0) {
                    await client.query('ROLLBACK');
                    res.status(500).json({ 
                        message: "Ошибка при создании публикации. Неудачное сохранение публикации" 
                    });
                    return;
                }
                const publicationFileInfo = await db.query(
                    `INSERT INTO publications_files (url, size, type, publication_id) 
                    VALUES ($1, $2, $3, $4) 
                    RETURNING id, url, size, type`,
                    [
                        publicationInfo.file.url, 
                        publicationInfo.file.size, 
                        publicationInfo.file.type,
                        createdPublicationInfo.rows[0].id
                    ]
                );

                if (publicationFileInfo.rows.length === 0) {
                    await client.query('ROLLBACK');
                    res.status(500).json({ 
                        message: "Ошибка при создании публикации. Неудачное сохранение информации о файле" 
                    });
                    return;
                }
                res.status(200).json({ 
                    message: "Публикация успешно создана", 
                    publication: {
                        ...createdPublicationInfo.rows[0],
                        file: {
                            ...publicationFileInfo.rows[0],
                            url:`${ process.env.HOST_URL }${publicationFileInfo.rows[0].url}`
                        }
                    }
                });
                return;
            }
            res.status(400).json({ message: "Ошибка при создании публикации. Отсутствует файл" });
            return;
        }
        catch (error) {
            await client.query('ROLLBACK');

            res.status(500).json({ message: "Ошибка при создании публикации" });
            console.log(error);
            return;
        }
        finally {
            client.release();
        }
    }
    static async deletePublication(req: Request, res: Response) {
        const client = await db.getClient();

        try {
            const publicationId = Number(req.query.id);

            if (publicationId) {
                const deletedPublicationFile = await db.query(
                    `
                        DELETE FROM publications_files
                        WHERE publication_id = $1
                        RETURNING id, url
                    `,
                    [publicationId]
                );

                if (deletedPublicationFile.rowCount === 0) {
                    await client.query('ROLLBACK');
                    res.status(500).json({ message: "Ошибка при удалении публикации. Ошибка удаления файла" });
                    return;
                }

                const deletedPublication = await db.query(
                    `
                        DELETE FROM publications
                        WHERE id = $1
                        RETURNING id, date
                    `,
                    [publicationId]
                );

                if (deletedPublication.rowCount === 0) {
                    await client.query('ROLLBACK');
                    res.status(500).json({ message: "Ошибка при удалении публикации. Публикация не найдена" });
                    return;
                }

                const deletingFilesStatus = await fsHelpers.removeFiles([deletedPublicationFile.rows[0].url]);

                if (deletingFilesStatus.status === 500) {
                    await client.query('ROLLBACK');
                    res.status(500).json({ message: "Ошибка при удалении публикации. Ошибка удаления файла в статике" });
                    return;
                }

                res.status(200).json({ message: "Публикация успешно удалена" });
                return;
            }
            res.status(500).json({ message: "Ошибка при удалении публикации. Публикация не найдена" });
            return;
        }
        catch (error) {
            await client.query('ROLLBACK');

            res.status(500).json({ message: "Ошибка при удалении публикации" });
            console.log(error);
            return;
        }
        finally {
            client.release();
        }
    }
}

export default PublicationsController;