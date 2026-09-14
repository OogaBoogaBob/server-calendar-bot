require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

const db = require('./database');

const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});


// ============================
// Create the calendar message
// ============================

async function updateCalendar(guild) {

    const calendarChannel = guild.channels.cache.find(
        channel => channel.name === 'events'
    );

    if (!calendarChannel) {
        console.log('Could not find the #events channel.');
        return;
    }


    const events = db.prepare(`
        SELECT *
        FROM events
        WHERE guild_id = ?
        ORDER BY date ASC
    `).all(guild.id);


    let message =
        '📅 **SERVER CALENDAR**\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n';


    if (events.length === 0) {

        message += '📭 No events scheduled yet.';

    } else {

        let currentMonth = '';


        for (const event of events) {

            const date = new Date(event.date + 'T00:00:00');

            const month = date.toLocaleDateString('en-US', {
                month: 'long',
                year: 'numeric'
            });


            if (month !== currentMonth) {

                currentMonth = month;

                message +=
                    `🗓️ **${month.toUpperCase()}**\n\n`;
            }


            const day = date.getDate();


            message +=
                `**${day}** • ${event.name}\n`;


            if (event.description) {

                message +=
                    `   └─ ${event.description}\n`;
            }


            message += '\n';
        }
    }


    // See if we already have a calendar message
    const savedMessage = db.prepare(`
        SELECT *
        FROM calendar_messages
        WHERE guild_id = ?
    `).get(guild.id);


    if (savedMessage) {

        try {

            const calendarMessage =
                await calendarChannel.messages.fetch(
                    savedMessage.message_id
                );

            await calendarMessage.edit(message);

            return;

        } catch (error) {

            console.log(
                'Old calendar message could not be found. Creating a new one.'
            );
        }
    }


    // Create a new calendar message
    const newMessage =
        await calendarChannel.send(message);


    db.prepare(`
        INSERT OR REPLACE INTO calendar_messages
        (
            guild_id,
            channel_id,
            message_id
        )
        VALUES (?, ?, ?)
    `).run(
        guild.id,
        calendarChannel.id,
        newMessage.id
    );
}


// ============================
// Our /event command
// ============================

const commands = [

    new SlashCommandBuilder()
        .setName('event')
        .setDescription('Manage your server calendar')

        // /event add
        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription('Add an event to the calendar')

                .addStringOption(option =>
                    option
                        .setName('date')
                        .setDescription('Date (YYYY-MM-DD)')
                        .setRequired(true)
                )

                .addStringOption(option =>
                    option
                        .setName('name')
                        .setDescription('Name of the event')
                        .setRequired(true)
                )

                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('Optional description')
                        .setRequired(false)
                )
        )

        // /event list
        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription('Show all calendar events')
        )

        // /event delete
        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription('Delete an event from the calendar')

                .addIntegerOption(option =>
                    option
                        .setName('id')
                        .setDescription('The Event ID')
                        .setRequired(true)
                )
        )

        // /event edit
        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription('Edit an existing calendar event')

                .addIntegerOption(option =>
                    option
                        .setName('id')
                        .setDescription('The Event ID')
                        .setRequired(true)
                )

                .addStringOption(option =>
                    option
                        .setName('date')
                        .setDescription('New date (YYYY-MM-DD)')
                        .setRequired(true)
                )

                .addStringOption(option =>
                    option
                        .setName('name')
                        .setDescription('New event name')
                        .setRequired(true)
                )

                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription('New description')
                        .setRequired(false)
                )
        )

].map(command => command.toJSON());


// ============================
// Register commands
// ============================

const rest = new REST({ version: '10' })
    .setToken(process.env.DISCORD_TOKEN);


async function registerCommands() {

    try {

        console.log('Registering commands...');

        await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            ),
            {
                body: commands
            }
        );

        console.log('Commands registered!');

    } catch (error) {

        console.error(error);

    }
}


// ============================
// When the bot connects
// ============================

client.once('ready', async () => {

    console.log('Server Calendar is online!');

    await updateCalendar(client.guilds.cache.first());

});


// ============================
// Handle Discord commands
// ============================

client.on('interactionCreate', async interaction => {

    if (!interaction.isChatInputCommand()) {
        return;
    }

    if (interaction.commandName !== 'event') {
        return;
    }


    // ============================
    // /event add
    // ============================

    if (interaction.options.getSubcommand() === 'add') {

        const date =
            interaction.options.getString('date');

        const name =
            interaction.options.getString('name');

        const description =
            interaction.options.getString('description') || '';


        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {

            await interaction.reply(
                '❌ Please use the date format YYYY-MM-DD.'
            );

            return;
        }


        const result = db.prepare(`
            INSERT INTO events
            (
                guild_id,
                name,
                date,
                description,
                created_by,
                created_at
            )
            VALUES (?, ?, ?, ?, ?, ?)
        `).run(
            interaction.guildId,
            name,
            date,
            description,
            interaction.user.id,
            new Date().toISOString()
        );


        await updateCalendar(interaction.guild);


        await interaction.reply(
            `✅ Added **${name}** for **${date}**!\nEvent ID: \`${result.lastInsertRowid}\``
        );

        return;
    }


    // ============================
    // /event list
    // ============================

    if (interaction.options.getSubcommand() === 'list') {

        const events = db.prepare(`
            SELECT *
            FROM events
            WHERE guild_id = ?
            ORDER BY date ASC
        `).all(interaction.guildId);


        if (events.length === 0) {

            await interaction.reply(
                '📅 There are no events yet!'
            );

            return;
        }


        let message = '📅 **UPCOMING EVENTS**\n\n';


        for (const event of events) {

            message +=
                `**${event.date}** — ${event.name}\n`;

            if (event.description) {

                message +=
                    `> ${event.description}\n`;
            }

            message +=
                `> Event ID: \`${event.id}\`\n\n`;
        }


        await interaction.reply(message);

        return;
    }


    // ============================
    // /event delete
    // ============================

    if (interaction.options.getSubcommand() === 'delete') {

        const id =
            interaction.options.getInteger('id');


        const event = db.prepare(`
            SELECT *
            FROM events
            WHERE id = ?
            AND guild_id = ?
        `).get(
            id,
            interaction.guildId
        );


        if (!event) {

            await interaction.reply(
                `❌ I couldn't find Event ID \`${id}\`.`
            );

            return;
        }


        db.prepare(`
            DELETE FROM events
            WHERE id = ?
            AND guild_id = ?
        `).run(
            id,
            interaction.guildId
        );


        await updateCalendar(interaction.guild);


        await interaction.reply(
            `🗑️ Deleted **${event.name}** (${event.date}).`
        );

        return;
    }


    // ============================
    // /event edit
    // ============================

    if (interaction.options.getSubcommand() === 'edit') {

        const id =
            interaction.options.getInteger('id');

        const date =
            interaction.options.getString('date');

        const name =
            interaction.options.getString('name');

        const description =
            interaction.options.getString('description') || '';


        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {

            await interaction.reply(
                '❌ Please use the date format YYYY-MM-DD.'
            );

            return;
        }


        const event = db.prepare(`
            SELECT *
            FROM events
            WHERE id = ?
            AND guild_id = ?
        `).get(
            id,
            interaction.guildId
        );


        if (!event) {

            await interaction.reply(
                `❌ I couldn't find Event ID \`${id}\`.`
            );

            return;
        }


        db.prepare(`
            UPDATE events
            SET
                date = ?,
                name = ?,
                description = ?
            WHERE id = ?
            AND guild_id = ?
        `).run(
            date,
            name,
            description,
            id,
            interaction.guildId
        );


        await updateCalendar(interaction.guild);


        await interaction.reply(
            `✏️ Updated Event ID \`${id}\`!\n**${name}** is now scheduled for **${date}**.`
        );

        return;
    }

});


registerCommands();

client.login(process.env.DISCORD_TOKEN);