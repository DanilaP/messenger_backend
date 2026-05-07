import { Request, Response } from 'express';
import { db } from '../../../db';
import { changeBasicPublicationInfo } from '../../models/publications/model-helpers';
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
                    `INSERT INTO publications (user_id, text, date, archived) 
                    VALUES ($1, $2, $3, $4) 
                    RETURNING id, user_id as "userId", text, date, archived`,
                    [
                        userId, 
                        text, 
                        moment().format('YYYY-MM-DD'),
                        false
                    ]
                );
                if (createdPublicationInfo.rows.length === 0) {
                    await client.query('ROLLBACK');
                    await fsHelpers.removeFiles([publicationInfo.file.url]);
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
                    await fsHelpers.removeFiles([publicationInfo.file.url]);
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
    static async changePublication(req: Request, res: Response) {
        try {
            const userId = userHelpers.getUserIdFromToken(req);
            const { publicationId, text } = req.body;
            let archived = undefined;

            if (req.body.archived) {
                if (req.body.archived === "true" || req.body.archived === "false") {
                    archived = req.body.archived;
                }
                else {
                    res.status(400).json({ message: "Ошибка при изменении публикации. Передан некорректный тип данных" });
                    return;
                }
            }

            if (publicationId && (text || req.files)) {
                //Обновляем базову информацию про публикацию
                const updatePublicationResponse = await changeBasicPublicationInfo(userId, publicationId, { text, archived });
                let updatedPublicationFileUrl: string | null = null;

                //Если передали обновленный файл
                if (req.files && updatePublicationResponse.status === 200) {
                    //Проверка на количество файлов (ограничение 1 файл на 1 публикацию)
                    if (Array.isArray(req.files.files)) {
                        res.status(400).json({ 
                            message: "Ошибка при изменении публикации. Выбрано более 1 файла" 
                        });
                        return;
                    }
                    //Получаем текущую информацию об изменяемой публикации
                    const currentPublicationFileInfo = await db.query(
                        `
                            select 
                                json_build_object('url', url, 'size', size, 'type', type) as file
                            from publications
                            join publications_files on publications_files.publication_id = publications.id 
                            where user_id = $1 and publications.id = $2   
                        `,
                        [userId, publicationId]
                    );
                    //Сохраняем обновленный файл
                    const uploadedFileInfo = (await fsHelpers.uploadFiles(req.files, "/publications"));

                    if (uploadedFileInfo.status === 200) {
                        //Удаляем прежний файл
                        const deletedFileInfo = await fsHelpers.removeFiles([currentPublicationFileInfo.rows[0].file.url]);

                        //Проверяем, что файл действительно удален
                        if (deletedFileInfo.status === 200) {
                            //Обновляем ссылку на файл в бд
                            await db.query(
                                `
                                    UPDATE publications_files
                                    SET url = $2
                                    WHERE publications_files.publication_id = $1
                                `,
                                [publicationId, uploadedFileInfo.filelist[0].url]
                            );
                            updatedPublicationFileUrl = `${ process.env.HOST_URL }${uploadedFileInfo.filelist[0].url}`;
                        }
                        else {
                            //Удаляем загруженный файл
                            await fsHelpers.removeFiles([uploadedFileInfo.filelist[0].url]);
                            res.status(400).json({ 
                                message: "Ошибка при изменении публикации. Ошибка при работе с файлом"
                            });
                            return;
                        }
                    }
                    else {
                        res.status(400).json({ 
                            message: "Ошибка при изменении публикации. Ошибка при сохранении файла"
                        });
                        return;
                    }
                }

                const responseObject: { message: string, updatedFileUrl?: string } = {
                    message: updatePublicationResponse.message
                }
                //Если изменяли закрепленный за публикацией файл - возвращаем обновленный url файла
                if (updatedPublicationFileUrl) {
                    responseObject.updatedFileUrl = updatedPublicationFileUrl
                }
                res.status(updatePublicationResponse.status).json(responseObject);
                return;
            }
            res.status(400).json({ message: "Ошибка при изменении публикации. Данные не должны быть пустыми" });
            return;
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при изменении публикации" });
            console.log(error);
            return;
        }
    }
}

export default PublicationsController;