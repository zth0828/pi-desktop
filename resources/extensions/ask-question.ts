import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "ask_question",
    label: "Ask Question",
    description:
      "Ask the user one or more multiple-choice questions when you need clarification, technical decisions, architecture trade-offs, or user preference before proceeding. Provide 2-4 distinct options.",
    parameters: {
      type: "object",
      required: ["question", "options"],
      properties: {
        question: {
          type: "string",
          description: "Clear single-sentence question shown to user",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "2 to 4 distinct options for the user to choose from",
        },
      },
    },
    async execute(_toolCallId, params: { question: string; options: string[] }, _signal, _onUpdate, ctx) {
      if (!ctx.hasUI) {
        return {
          content: [
            {
              type: "text",
              text: "Interactive UI is not available in current mode. Ask the user in plain text instead.",
            },
          ],
        };
      }
      const selected = await ctx.ui.select(params.question, params.options);
      return {
        content: [
          {
            type: "text",
            text: selected
              ? `User selected: ${selected}`
              : "User cancelled or dismissed the selection dialog without choosing an option.",
          },
        ],
      };
    },
  });
}
