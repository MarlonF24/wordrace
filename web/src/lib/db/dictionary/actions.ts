"use server";

import * as queries from "./service";

export const getSensesAction = async (word: string) => {
    return await queries.getSenses(word);
}