import { db } from "../../db";

export const getChatMemberPermissions = async (memberId: number, chatId: number) => {
	const memberPermissions = await db.query<{ name: string }>(
		`
            SELECT 
                name 
            FROM chats_members 
            JOIN chats_permissions_and_roles_info on chats_permissions_and_roles_info.role_id = chats_members.role_id 
            JOIN chats_permissions on chats_permissions.id = chats_permissions_and_roles_info.permission_id 
            WHERE user_id = $1 and chat_id = $2
        `
		,
		[memberId, chatId]
	);
	return memberPermissions.rows.map(el => el.name);
};