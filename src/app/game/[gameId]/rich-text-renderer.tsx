import { type RichText } from "@/lib/db/dictionary/types";
import { isFunctionWordToken } from "@/lib/part-of-speech";
import { WordButton } from "./word-button";

/**
 * Render rich text as literal strings plus clickable word tokens.
 *
 * `suppressFunctionWords` is used for collide-mode prose only. Explicit lexical
 * links leave it disabled so dictionary-provided links stay clickable.
 */
export function RichTextRenderer({
    tokens,
    side,
    suppressFunctionWords = false,
}: {
    tokens: RichText;
    side: "start" | "target";
    suppressFunctionWords?: boolean;
}) {
    return (
        <>
            {tokens.map((token, index) => {
                if (typeof token === "string") {
                    return (
                        <span key={index} className="whitespace-pre-wrap">
                            {token}
                        </span>
                    );
                }
                if (suppressFunctionWords && isFunctionWordToken(token)) {
                    return (
                        <span key={index} className="whitespace-pre-wrap">
                            {token.w}
                        </span>
                    );
                }
                return (
                    <WordButton
                        key={index}
                        token={token}
                        side={side}
                    >
                        {token.w}
                    </WordButton>
                );
            })}
        </>
    );
}
