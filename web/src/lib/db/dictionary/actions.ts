"use server";

import * as queries from "./service";

export const getGlossesAction = async (word: string) => {
    return await queries.getGlosses(word);
}