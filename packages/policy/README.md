# @persona/policy

Decides when the bot answers and which admin commands run.

- `createReplyPolicy({ direct, group, names, allowedGroups, unpromptedProbability })`:
  returns `always` or `never` for each message. `allowedGroups` is a hard deny: a group
  outside the list never gets a reply, even when the bot is mentioned.
- `createCommands({ adminNumbers, botName, state })`: `!whois` for anyone, `!pause` and
  `!resume` for admins.
