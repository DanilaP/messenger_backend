import { db } from "../../db";

export async function getChatMembers(chatId: number, mode: "prev" | "next", cursorId: number, limit = 20) {
	const isPrev = mode === "prev";
	const comparison = isPrev ? "<" : ">";   // направление относительно курсора
	const order      = isPrev ? "DESC" : "ASC";

	const conditions = ["chat_id = $1"];
	const params     = [chatId];

	// Первая загрузка (без курсора) — берём с начала
	if (cursorId != null) {
		params.push(cursorId);
		conditions.push(`users.id ${comparison} $${params.length}`);
	}

	params.push(limit);

	const { rows } = await db.query(
		`
            select
                json_build_object(
                'id',      users."id",
                'name',    users."name",
                'surname', users."surname",
                'avatar',  users."avatar",
                'role',    chats_roles."name"
                ) as user
            from chats_members
            join users on users.id = chats_members.user_id
            join chats_roles on chats_roles.id = chats_members.role_id
            where ${ conditions.join(" and ") }
            order by users.id ${ order }
            limit $${ params.length }
        `,
		params
	);

	// При «prev» СУБД отдаёт в обратном порядке — разворачиваем,
	// чтобы клиент всегда получал список по возрастанию id
	if (isPrev) rows.reverse();

	return rows.map(r => r.user);
}