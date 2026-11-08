import { modelTimeData, modelTimeInstructions } from "@/modules/ai/domain/model-time";
import { AiError, type AiRequest, type AiResponse, type ResponseInput } from "@/modules/ai/domain/contracts";
import { MAX_CONTEXT, MAX_STEPS, chatTools, instructions, type RecordLink } from "./policy";
export async function runChatLoop(input: ResponseInput[], call: (request: AiRequest) => Promise<AiResponse>, execute: (name: string, args: unknown) => Promise<{
    data: unknown;
    links: RecordLink[];
}>, model: string, timeZone = "Asia/Novosibirsk") {
    const links: RecordLink[] = [];
    for (let step = 0; step < MAX_STEPS; step++) {
        if (JSON.stringify(input).length > MAX_CONTEXT)
            throw new AiError("AI_CONTEXT_LIMIT");
        const response = await call({ model, instructions: `${instructions} ${modelTimeInstructions}`, input: "", inputItems: input, maxOutputTokens: 1200, functionTools: chatTools });
        const calls = response.functionCalls ?? [];
        if (!calls.length)
            return { text: response.text.slice(0, 8000), links };
        if (calls.length > 4)
            throw new AiError("AI_TOOL_LIMIT");
        // The last iteration cannot generate further side effects, including proposals.
        if (step === MAX_STEPS - 1)
            throw new AiError("AI_STEP_LIMIT");
        for (const c of calls) {
            if (!chatTools.some(t => t.name === c.name))
                throw new AiError("AI_TOOL_NOT_ALLOWED");
            let result: {
                data: unknown;
                links: RecordLink[];
            };
            try {
                result = await execute(c.name, JSON.parse(c.arguments));
            }
            catch {
                result = { data: { error: "Запись недоступна или параметры неверны" }, links: [] };
            }
            links.push(...result.links);
            const output = JSON.stringify({ untrusted_data: modelTimeData(result.data, timeZone) });
            if (output.length > 9000)
                throw new AiError("AI_CONTEXT_LIMIT");
            input.push(c, { type: "function_call_output", call_id: c.call_id, output });
        }
    }
    throw new AiError("AI_STEP_LIMIT");
}
