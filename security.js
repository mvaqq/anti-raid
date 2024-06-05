require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, PermissionsBitField, ButtonBuilder, ActionRowBuilder, ButtonStyle, REST, Routes, AuditLogEvent } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

const GUILD_ID = process.env.GUILD_ID;
const QUARANTINE_ROLE_NAME = process.env.QUARANTINE_ROLE_NAME;
const LOG_CHANNEL_ID = process.env.LOG_CHANNEL_ID;

const joinTimes = new Map();
const leaveTimes = new Map();
const messageTimes = new Map();
const warnedUsers = new Set();
const leaveThreshold = 5;
const leaveTimeFrame = 60 * 1000;
const spamTimeFrame = 30 * 1000;
const spamThreshold = 5;

const approvedUsers = ['approved_user_id_1', 'approved_user_id_2'];
const approvedBots = ['1242521460606505072', 'approved_bot_id_2'];

const userRoles = new Map();

client.once('ready', () => {
    console.log(`Logged in as ${client.user.tag}`);
    registerCommands();
});

const registerCommands = async () => {
    const commands = [
        {
            name: 'remove-quarantine',
            description: 'Removes Quarantine from a user',
            options: [
                {
                    type: 6, // USER type
                    name: 'user',
                    description: 'The user to remove the quarantine from quarantine',
                    required: true
                }
            ]
        }
    ];

    const rest = new REST({ version: '9' }).setToken(process.env.DISCORD_TOKEN);

    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(client.user.id, GUILD_ID),
            { body: commands }
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }
};

const logAction = async (guild, description) => {
    const logChannel = guild.channels.cache.get(LOG_CHANNEL_ID);
    if (logChannel) {
        const embed = new EmbedBuilder()
            .setColor('#0099ff')
            .setDescription(description)
            .setTimestamp();
        await logChannel.send({ embeds: [embed] });
    }
};

client.on('guildMemberAdd', async member => {
    if (member.guild.id !== GUILD_ID) return;

    const now = Date.now();
    if (!joinTimes.has(member.guild.id)) {
        joinTimes.set(member.guild.id, []);
    }

    const guildJoinTimes = joinTimes.get(member.guild.id);
    guildJoinTimes.push(now);

    const oneMinuteAgo = now - 60 * 1000;
    joinTimes.set(member.guild.id, guildJoinTimes.filter(time => time > oneMinuteAgo));

    if (guildJoinTimes.length > 5) {
        logAction(member.guild, 'Raid detected! Taking action.');
        // Implement raid handling logic here
    }

    if (member.user.bot && !approvedBots.includes(member.id)) {
        const auditLogs = await member.guild.fetchAuditLogs({
            type: AuditLogEvent.BotAdd,
            limit: 1
        });

        const logEntry = auditLogs.entries.first();
        if (logEntry) {
            const inviter = logEntry.executor;
            if (!approvedUsers.includes(inviter.id)) {
                try {
                    const inviterMember = await member.guild.members.fetch(inviter.id);
                    const quarantineRole = member.guild.roles.cache.find(role => role.name === QUARANTINE_ROLE_NAME);
                    if (quarantineRole) {
                        userRoles.set(inviterMember.id, inviterMember.roles.cache.filter(role => role.id !== member.guild.id));
                        await inviterMember.roles.set([]); // Remove all roles
                        await inviterMember.roles.add(quarantineRole, 'Invited unauthorized bot');
                        logAction(member.guild, `User ${inviter.tag} has been quarantined for inviting unauthorized bot ${member.user.tag}.`);
                    } else {
                        console.error(`Role ${QUARANTINE_ROLE_NAME} not found`);
                    }
                } catch (error) {
                    console.error(`Error fetching inviter or assigning role: ${error.message}`);
                }
            }
        }

        await member.ban({ reason: 'Unauthorized bot' });
        logAction(member.guild, `Unauthorized bot ${member.user.tag} has been banned.`);
    }
});

client.on('guildMemberRemove', async member => {
    if (member.guild.id !== GUILD_ID) return;

    const now = Date.now();
    if (!leaveTimes.has(member.guild.id)) {
        leaveTimes.set(member.guild.id, []);
    }

    const guildLeaveTimes = leaveTimes.get(member.guild.id);
    guildLeaveTimes.push(now);

    const thresholdTime = now - leaveTimeFrame;
    leaveTimes.set(member.guild.id, guildLeaveTimes.filter(time => time > thresholdTime));

    if (guildLeaveTimes.length > leaveThreshold) {
        logAction(member.guild, 'Mass leave detected! Investigating...');

        const auditLogs = await member.guild.fetchAuditLogs({ type: AuditLogEvent.MemberKick, limit: 10 });
        const kickLogs = auditLogs.entries.filter(entry => entry.createdTimestamp > thresholdTime);

        const kickCounts = kickLogs.reduce((counts, log) => {
            const executorId = log.executor.id;
            counts[executorId] = (counts[executorId] || 0) + 1;
            return counts;
        }, {});

        const suspiciousUsers = Object.entries(kickCounts).filter(([, count]) => count > leaveThreshold / 2);

        for (const [userId] of suspiciousUsers) {
            const user = await client.users.fetch(userId);
            await member.guild.members.ban(user, { reason: 'Detected as part of mass leave event.' });
            logAction(member.guild, `Banned ${user.tag} for suspected mass leave involvement.`);
        }
    }
});

client.on('messageCreate', async message => {
    if (message.guild.id !== GUILD_ID || message.author.bot) return;

    if (message.embeds.length > 0) {
        const guild = message.guild;
        const member = message.member;

        // Delete the message
        await message.delete();

        // Save current roles and remove all roles from the user except @everyone
        userRoles.set(member.id, member.roles.cache.filter(role => role.id !== guild.id));
        const rolesToRemove = member.roles.cache.filter(role => role.id !== guild.id);
        await member.roles.remove(rolesToRemove);

        // Add the quarantine role
        const quarantineRole = guild.roles.cache.find(role => role.name === QUARANTINE_ROLE_NAME);
        await member.roles.add(quarantineRole);

        // Notify the user
        await message.channel.send(`${member.user.tag} has been quarantined for attempting to send embeds.`);
    }

    if (message.content.includes('@everyone') && !approvedUsers.includes(message.author.id)) {
        await message.delete();
        const textChannel = message.channel;
        if (textChannel) {
            const warningMessage = await textChannel.send(`${message.author}, you are not authorized to use that.`);
            setTimeout(() => warningMessage.delete(), 5000);
        }
        return;
    }

    if (message.content.includes('https:') || message.content.includes('discord.gg')) {
        await message.delete();
        const member = await message.guild.members.fetch(message.author.id);
        userRoles.set(member.id, member.roles.cache.filter(role => role.id !== message.guild.id));
        await member.roles.set([], 'Posted unauthorized link').catch(console.error);
        logAction(message.guild, `${message.author} has been timed out for posting unauthorized links.`);
        return;
    }

    const now = Date.now();
    const authorId = message.author.id;

    if (!messageTimes.has(authorId)) {
        messageTimes.set(authorId, []);
    }

    const userMessageTimes = messageTimes.get(authorId);
    userMessageTimes.push(now);

    const thirtySecondsAgo = now - spamTimeFrame;
    messageTimes.set(authorId, userMessageTimes.filter(time => time > thirtySecondsAgo));

    if (userMessageTimes.length > spamThreshold) {
        if (!warnedUsers.has(authorId)) {
            warnedUsers.add(authorId);
            const textChannel = message.channel;
            if (textChannel) {
                const warningMessage = await textChannel.send(`${message.author}, you are sending messages too quickly!`);
                setTimeout(() => warningMessage.delete(), 5000);
            }
        }

        const messagesToDelete = await message.channel.messages.fetch({ limit: 100 });
        const userMessages = messagesToDelete.filter(msg => msg.author.id === authorId);
        await message.channel.bulkDelete(userMessages, true);

        const member = await message.guild.members.fetch(authorId);
        await member.timeout(10 * 60 * 1000, 'Spam detected'); // Timeout the user for 10 minutes
        userRoles.set(member.id, member.roles.cache.filter(role => role.id !== message.guild.id));
        await member.roles.set([], 'Spamming').catch(console.error);
        logAction(message.guild, `${message.author} has been timed out for spamming.`);
    }
});

client.on('guildMemberUpdate', async (oldMember, newMember) => {
    if (newMember.guild.id !== GUILD_ID) return;

    const addedRoles = newMember.roles.cache.filter(role => !oldMember.roles.cache.has(role.id));
    for (const role of addedRoles.values()) {
        if (role.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const auditLogs = await newMember.guild.fetchAuditLogs({
                type: AuditLogEvent.MemberRoleUpdate,
                limit: 1
            });

            const logEntry = auditLogs.entries.first();

            if (logEntry) {
                const executor = logEntry.executor;
                const target = logEntry.target;

                if (executor && target && !approvedUsers.includes(executor.id)) {
                    try {
                        const executorMember = await newMember.guild.members.fetch(executor.id);

                        // Remove all roles from the executor
                        userRoles.set(executorMember.id, executorMember.roles.cache.filter(role => role.id !== newMember.guild.id));
                        await executorMember.roles.set([], 'Unauthorized admin role assignment').catch(console.error);

                        const quarantineRole = newMember.guild.roles.cache.find(role => role.name === QUARANTINE_ROLE_NAME);
                        if (quarantineRole) {
                            await executorMember.roles.add(quarantineRole, 'Assigned quarantine role due to unauthorized admin role assignment').catch(console.error);
                        } else {
                            console.error(`Role ${QUARANTINE_ROLE_NAME} not found`);
                        }

                        const targetMember = await newMember.guild.members.fetch(target.id);
                        await targetMember.roles.remove(role, 'Unauthorized admin role assignment').catch(console.error);

                        logAction(newMember.guild, `Admin role assigned by ${executor.tag} to ${target.tag} was removed. ${executor.tag} was also assigned the quarantine role.`);
                    } catch (error) {
                        console.error(`Error handling unauthorized admin role assignment: ${error.message}`);
                    }
                }
            }
        }
    }
});

client.on('roleCreate', async role => {
    const auditLogs = await role.guild.fetchAuditLogs({
        type: AuditLogEvent.RoleCreate,
        limit: 1
    });

    const logEntry = auditLogs.entries.first();

    if (logEntry) {
        const executor = logEntry.executor;

        if (!approvedUsers.includes(executor.id)) {
            try {
                await role.delete('Unauthorized role creation').catch(console.error);
            } catch (error) {
                console.error(`Failed to delete role: ${error.message}`);
                return;
            }

            const executorMember = await role.guild.members.fetch(executor.id);

            // Remove all roles from the executor
            userRoles.set(executorMember.id, executorMember.roles.cache.filter(role => role.id !== role.guild.id));
            await executorMember.roles.set([], 'Unauthorized role creation').catch(console.error);

            const quarantineRole = role.guild.roles.cache.find(r => r.name === QUARANTINE_ROLE_NAME);
            if (quarantineRole) {
                await executorMember.roles.add(quarantineRole, 'Assigned quarantine role due to unauthorized role creation').catch(console.error);
            } else {
                console.error(`Role ${QUARANTINE_ROLE_NAME} not found`);
            }

            logAction(role.guild, `Role \`${role.name}\` created by ${executor.tag} was deleted and all roles were removed from ${executor.tag}, who was also assigned the quarantine role.`);
        }
    }
});

client.on('channelCreate', async channel => {
    const auditLogs = await channel.guild.fetchAuditLogs({
        type: AuditLogEvent.ChannelCreate,
        limit: 1
    });

    const logEntry = auditLogs.entries.first();

    if (logEntry) {
        const executor = logEntry.executor;

        if (!approvedUsers.includes(executor.id)) {
            try {
                await channel.delete('Unauthorized channel creation').catch(console.error);
            } catch (error) {
                console.error(`Failed to delete channel: ${error.message}`);
                return;
            }

            const executorMember = await channel.guild.members.fetch(executor.id);

            // Remove all roles from the executor
            userRoles.set(executorMember.id, executorMember.roles.cache.filter(role => role.id !== channel.guild.id));
            await executorMember.roles.set([], 'Unauthorized channel creation').catch(console.error);

            const quarantineRole = channel.guild.roles.cache.find(r => r.name === QUARANTINE_ROLE_NAME);
            if (quarantineRole) {
                await executorMember.roles.add(quarantineRole, 'Assigned quarantine role due to unauthorized channel creation').catch(console.error);
            } else {
                console.error(`Role ${QUARANTINE_ROLE_NAME} not found`);
            }

            logAction(channel.guild, `Channel \`${channel.name}\` created by ${executor.tag} was deleted and all roles were removed from ${executor.tag}, who was also assigned the quarantine role.`);
        }
    }
});

client.on('channelDelete', async channel => {
    const auditLogs = await channel.guild.fetchAuditLogs({
        type: AuditLogEvent.ChannelDelete,
        limit: 1
    });

    const logEntry = auditLogs.entries.first();

    if (logEntry) {
        const executor = logEntry.executor;

        if (!approvedUsers.includes(executor.id)) {
            const executorMember = await channel.guild.members.fetch(executor.id);

            // Remove all roles from the executor
            userRoles.set(executorMember.id, executorMember.roles.cache.filter(role => role.id !== channel.guild.id));
            await executorMember.roles.set([], 'Unauthorized channel deletion').catch(console.error);

            const quarantineRole = channel.guild.roles.cache.find(r => r.name === QUARANTINE_ROLE_NAME);
            if (quarantineRole) {
                await executorMember.roles.add(quarantineRole, 'Assigned quarantine role due to unauthorized channel deletion').catch(console.error);
            } else {
                console.error(`Role ${QUARANTINE_ROLE_NAME} not found`);
            }

            logAction(channel.guild, `Channel \`${channel.name}\` deleted by ${executor.tag}, who was assigned the quarantine role and had all their roles removed.`);
        }
    }
});

client.on('channelUpdate', async (oldChannel, newChannel) => {
    const auditLogs = await newChannel.guild.fetchAuditLogs({
        type: AuditLogEvent.ChannelUpdate,
        limit: 1
    });

    const logEntry = auditLogs.entries.first();

    if (logEntry) {
        const executor = logEntry.executor;

        if (!approvedUsers.includes(executor.id)) {
            try {
                const executorMember = await newChannel.guild.members.fetch(executor.id);

                // Revert channel name
                await newChannel.setName(oldChannel.name, 'Unauthorized channel update').catch(console.error);


                userRoles.set(executorMember.id, executorMember.roles.cache.filter(role => role.id !== newChannel.guild.id));
                await executorMember.roles.set([], 'Unauthorized channel update').catch(console.error);

                const quarantineRole = newChannel.guild.roles.cache.find(r => r.name === QUARANTINE_ROLE_NAME);
                if (quarantineRole) {
                    await executorMember.roles.add(quarantineRole, 'Assigned quarantine role due to unauthorized channel update').catch(console.error);
                } else {
                    console.error(`Role ${QUARANTINE_ROLE_NAME} not found`);
                }

                logAction(newChannel.guild, `Channel \`${oldChannel.name}\` updated by ${executor.tag} was reverted and all roles were removed from ${executor.tag}, who was also assigned the quarantine role.`);
            } catch (error) {
                console.error(`Error handling unauthorized channel update: ${error.message}`);
            }
        }
    }
});

client.on('webhookUpdate', async channel => {
    const auditLogs = await channel.guild.fetchAuditLogs({
        type: AuditLogEvent.WebhookCreate,
        limit: 1
    });

    const logEntry = auditLogs.entries.first();

    if (logEntry) {
        const executor = logEntry.executor;

        if (!approvedUsers.includes(executor.id)) {
            try {
                // Fetch and delete unauthorized webhooks
                const webhooks = await channel.fetchWebhooks();
                for (const webhook of webhooks.values()) {
                    if (webhook.owner.id === executor.id) {
                        await webhook.delete('Unauthorized webhook creation').catch(console.error);
                        logAction(channel.guild, `Unauthorized webhook \`${webhook.name}\` created by ${executor.tag} has been deleted.`);
                    }
                }


                const executorMember = await channel.guild.members.fetch(executor.id);
                const quarantineRole = channel.guild.roles.cache.find(role => role.name === QUARANTINE_ROLE_NAME);
                if (quarantineRole) {
                    await executorMember.roles.add(quarantineRole, 'Unauthorized webhook creation').catch(console.error);
                    logAction(channel.guild, `Unauthorized webhook created by ${executor.tag} has been deleted and the user has been quarantined.`);
                } else {
                    console.error(`Role ${QUARANTINE_ROLE_NAME} not found`);
                }
            } catch (error) {
                console.error(`Error handling unauthorized webhook: ${error.message}`);
            }
        }
    }
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName, options } = interaction;

    if (commandName === 'remove-quarantine') {
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            await interaction.reply('You do not have permission to use this command.');
            return;
        }

        const member = options.getMember('user');
        if (!member) {
            await interaction.reply('User not found.');
            return;
        }

        const guild = interaction.guild;

        userRoles.set(member.id, member.roles.cache.filter(role => role.id !== guild.id));
        const rolesToRemove = member.roles.cache.filter(role => role.id !== guild.id);
        await member.roles.remove(rolesToRemove);

        // Add the quarantine role
        const quarantineRole = guild.roles.cache.find(role => role.name === QUARANTINE_ROLE_NAME);
        await member.roles.add(quarantineRole);

        // Create an embed with buttons
        const embed = new EmbedBuilder()
            .setColor('##9e8aff')
            .setTitle('Quarantine Actions')
            .setDescription(`User ${member.user.tag} has been quarantined.`);

        const removeQuarantineButton = new ButtonBuilder()
            .setCustomId(`remove-quarantine-${member.id}`)
            .setLabel('Remove Quarantine')
            .setStyle(ButtonStyle.Primary);

        const reverseActionsButton = new ButtonBuilder()
            .setCustomId(`reverse-actions-${member.id}`)
            .setLabel('Reverse Actions')
            .setStyle(ButtonStyle.Danger);

        const row = new ActionRowBuilder().addComponents(removeQuarantineButton, reverseActionsButton);

        await interaction.reply({ embeds: [embed], components: [row] });
    }

    if (interaction.isButton()) {
        const [action, memberId] = interaction.customId.split('-');

        if (action === 'remove' && interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const member = await interaction.guild.members.fetch(memberId);
            if (member) {
                const quarantineRole = interaction.guild.roles.cache.find(role => role.name === QUARANTINE_ROLE_NAME);
                const defaultRole = interaction.guild.roles.cache.find(role => role.name === 'Player'); // Change 'Player' to your default role name

                await member.roles.remove(quarantineRole);
                await member.roles.add(defaultRole);

                await interaction.update({ content: `${member.user.tag} is no longer quarantined.`, embeds: [], components: [] });
            }
        } else if (action === 'reverse' && interaction.member.permissions.has(PermissionsBitField.Flags.Administrator)) {
            const member = await interaction.guild.members.fetch(memberId);
            if (member) {
                const roles = userRoles.get(member.id);
                if (roles) {
                    await member.roles.set(roles);
                    userRoles.delete(member.id);
                }

                await interaction.update({ content: `Reversed actions for ${member.user.tag}.`, embeds: [], components: [] });
            }
        }
    }
});

client.login(process.env.DISCORD_TOKEN);
