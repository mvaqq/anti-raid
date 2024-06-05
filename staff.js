const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
require('dotenv').config(); // Load environment variables from .env file

// Replace with your bot's token from the .env file
const TOKEN = process.env.TOKEN;

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages
    ]
});

const commands = [{
    name: 'staff',
    description: 'Get information about the server staff members'
}];

const rest = new REST({ version: '9' }).setToken(TOKEN);

client.once('ready', async () => {
    try {
        console.log('Started refreshing application (/) commands.');

        await rest.put(
            Routes.applicationGuildCommands(client.user.id, '1231274627452502146'), // Replace 'YOUR_GUILD_ID_HERE' with your guild ID
            { body: commands },
        );

        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error(error);
    }

    console.log('Bot is ready!');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'staff') {
        const roles = {
            "1231275753086124144": "Owner",
            "1231285850436931584": "Manager",
            "1231275699449368609": "Admin",
            "1231559367472713732": "Developer",
            "1231276084872347798": "Sr. Mod",
            "1231285923686125720": "Mod",
            "1231285989381640242": "Helper",
            "1231286095811973281": "Builder",
            "1231286026912268288": "Designer",
        };

        const members = await interaction.guild.members.fetch();

        // Group members by role
        let memberByRole = {};
        members.forEach(member => {
            let highestRoleFound = false;
            Object.keys(roles).forEach(roleId => {
                if (member.roles.cache.has(roleId) && !highestRoleFound) {
                    if (!memberByRole[roles[roleId]]) {
                        memberByRole[roles[roleId]] = [];
                    }
                    memberByRole[roles[roleId]].push(member);
                    highestRoleFound = true;
                }
            });
        });

        // Count total staff members
        let staffCount = Object.values(memberByRole).reduce((acc, members) => acc + members.length, 0);

        // Create embed
        const embed = new EmbedBuilder()
            .setTitle("Staff Members")
            .setDescription(`There are ${staffCount} <@&1231286559563579462> members.`)
            .setColor(0x73d0ff);

        // Add fields for each role
        Object.keys(roles).forEach(roleId => {
            let roleName = roles[roleId];
            if (memberByRole[roleName]) {
                let memberMentions = memberByRole[roleName].map(member => member.toString()).join('\n');
                embed.addFields({ name: roleName, value: memberMentions, inline: false });
            }
        });

        await interaction.reply({ embeds: [embed] });
    }
});

client.login(TOKEN); // Use process.env.TOKEN to access the token from environment variables
