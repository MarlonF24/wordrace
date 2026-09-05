/** Expected dictionary lookup failure that is safe to show to a player. */
export class DictionaryRecordError extends Error {
    /** Build an error whose message may cross a server boundary as public data. */
    constructor(message: string) {
        super(message);
        this.name = 'DictionaryRecordError';
    }
}

/** Narrow an unknown failure to a player-safe dictionary lookup error. */
export function isDictionaryRecordError(error: unknown): error is DictionaryRecordError {
    return error instanceof DictionaryRecordError;
}
