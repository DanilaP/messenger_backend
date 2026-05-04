import { Request, Response } from 'express';

class PublicationsController {
    static async getPublications(req: Request, res: Response) {
        try {
            
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при получении публикаций" });
            console.log(error);
            return;
        }
    }
    static async createPublication(req: Request, res: Response) {
        try {
            
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при создании публикации" });
            console.log(error);
            return;
        }
    }
    static async deletePublication(req: Request, res: Response) {
        try {
            
        }
        catch (error) {
            res.status(500).json({ message: "Ошибка при удалении публикации" });
            console.log(error);
            return;
        }
    }
}

export default PublicationsController;