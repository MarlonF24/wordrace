import { type RichText } from "@/lib/db/dictionary/types";
import { WordButton } from "./word-button";

export function RichTextRenderer({
    tokens,
    side,
}: {
    tokens: RichText;
    side: "start" | "target";
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
