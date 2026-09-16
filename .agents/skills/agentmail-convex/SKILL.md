---
name: agentmail-convex
description: Add a persistent email inbox to Convex with reactive queries for AI agents - threads, labels, and messages sync automatically to your database. Use this skill whenever the user mentions ai infrastructure, email, agentmail. Also trigger when discussing identity, reactive email queries in convex without polling, even if they don't explicitly ask for Agentmail.
---

# Agentmail

## Instructions

Use Agentmail to add a persistent email inbox to convex with reactive queries for ai agents - threads, labels, and messages sync automatically to your database. This Convex component integrates directly with your backend.

### Installation

```bash
npm install @agentmail/convex
```

### Capabilities

- Query email threads reactively with useQuery instead of polling external APIs
- Store complete message history with labels and thread relationships in Convex
- Send emails durably through mutations with automatic retry and delivery tracking
- Handle inbound webhooks with deduplication and isolated component architecture

## Examples

### how to build AI agent email inbox with persistent threads

AgentMail Convex component provides a stateful email inbox where every message persists with thread_id and labels in your Convex database. Subscribe to listInboundMessages({ threadId }) to watch threads update reactively as new emails arrive.

### reactive email queries in Convex without polling

Use useQuery with the AgentMail component to subscribe to inbox state changes in real-time. New mail appears instantly when AgentMail's webhook fires, eliminating the need to poll external email APIs.

### durable email sending with retry logic in Convex

Call agentmail.sendMessage() from mutations to queue emails with automatic retries through workpool actions. Track delivery status reactively by subscribing to the returned OutboundId.

### handle inbound email webhooks in Convex with deduplication

Mount the webhook handler in convex/http.ts using agentmail.handleWebhook(). Events are automatically deduplicated by event_id and processed through isolated workpools to prevent blocking.

## When NOT to use

- When a simpler built-in solution exists for your specific use case
- If you are not using Convex as your backend
- When the functionality provided by Agentmail is not needed

## Troubleshooting

**How does AgentMail Convex component store email data?**

The AgentMail component creates isolated tables (inboxes, inboundMessages, outboundMessages, events) in your Convex database. All email data including full message bodies, attachments metadata, and thread relationships are stored locally and queryable with standard Convex queries.

**Can I query email threads and messages reactively?**

Yes, the AgentMail component enables reactive email queries using standard Convex useQuery hooks. Subscribe to listInboundMessages({ threadId }) to watch thread updates in real-time as new messages arrive through webhooks.

**How reliable is email sending through this component?**

The AgentMail component provides durable email sending through Convex mutations that enqueue messages to workpool actions with bounded retries. Delivery status transitions (pending, sent, delivered, bounced) are tracked as reactive queries you can subscribe to.

**What happens when my agent receives an email?**

Configure an onMessageReceived callback that fires as an internal mutation when emails arrive. The callback receives both the message and complete thread context, allowing your AI agent to process emails with full conversation history without additional API calls.

## Resources

- [npm package](https://www.npmjs.com/package/%40agentmail%2Fconvex)
- [GitHub repository](https://github.com/agentmail-to/convex)
- [Live demo](https://www.npmjs.com/package/@agentmail/convex)
- [Convex Components Directory](https://www.convex.dev/components/agentmail/convex)
- [Convex documentation](https://docs.convex.dev)