require('dotenv').config();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder
} = require('discord.js');

const { createClient } = require('@supabase/supabase-js');


// ============================
// Connect to Supabase
// ============================

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_KEY
);


const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});


// ============================
// Create/update the calendar message
// ============================

async function updateCalendar(guild) {

    const calendarChannel = guild.channels.cache.find(
        channel => channel.name === 'events'
    );

    if (!calendarChannel) {
        console.log('Could not find the #events channel.');
        return;
    }


    const { data: events, error: eventsError } = await supabase
        .from('events')
        .select('*')
        .eq('guild_id', guild.id)
        .order('date', { ascending: true });


    if (eventsError) {
        console.error('Could not load events:', eventsError);
        return;
    }


    let message =
        '📅 **SERVER EVENTS CALENDAR**\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n';


    if (!events || events.length === 0) {

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


    // Look for the saved calendar message

    const { data: savedMessage, error: messageError } = await supabase
        .from('calendar_messages')
        .select('*')
        .eq('guild_id', guild.id)
        .maybeSingle();


    if (messageError) {
        console.error('Could not find saved calendar message:', messageError);
        return;
    }


    // Edit the existing calendar message

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


    const { error: saveMessageError } = await supabase
        .from('calendar_messages')
        .upsert({
            guild_id: guild.id,
            channel_id: calendarChannel.id,
            message_id: newMessage.id
        });


    if (saveMessageError) {
        console.error(
            'Could not save calendar message:',
            saveMessageError
        );
    }
}


// ============================
// /event command
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
// Register Discord commands
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

    setTimeout(async () => {
        await updateCalendar(
            client.guilds.cache.first()
        );
    }, 3000);

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


        const { data: event, error } = await supabase
            .from('events')
            .insert({
                guild_id: interaction.guildId,
                name: name,
                date: date,
                description: description,
                created_by: interaction.user.id,
                created_at: new Date().toISOString()
            })
            .select()
            .single();


        if (error) {

            console.error('Could not add event:', error);

            await interaction.reply(
                '❌ Something went wrong while adding the event.'
            );

            return;
        }


        await updateCalendar(interaction.guild);


        await interaction.reply(
            `✅ Added **${name}** for **${date}**!\nEvent ID: \`${event.id}\``
        );

        return;
    }


    // ============================
    // /event list
    // ============================

    if (interaction.options.getSubcommand() === 'list') {

        const { data: events, error } = await supabase
            .from('events')
            .select('*')
            .eq('guild_id', interaction.guildId)
            .order('date', { ascending: true });


        if (error) {

            console.error('Could not load events:', error);

            await interaction.reply(
                '❌ Something went wrong while loading the events.'
            );

            return;
        }


        if (!events || events.length === 0) {

            await interaction.reply(
                '📅 There are no events yet!'
            );

            return;
        }


        let message =
            '📅 **UPCOMING EVENTS**\n\n';


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


        const { data: event, error: findError } = await supabase
            .from('events')
            .select('*')
            .eq('id', id)
            .eq('guild_id', interaction.guildId)
            .maybeSingle();


        if (findError) {

            console.error('Could not find event:', findError);

            await interaction.reply(
                '❌ Something went wrong while finding the event.'
            );

            return;
        }


        if (!event) {

            await interaction.reply(
                `❌ I couldn't find Event ID \`${id}\`.`
            );

            return;
        }


        const { error: deleteError } = await supabase
            .from('events')
            .delete()
            .eq('id', id)
            .eq('guild_id', interaction.guildId);


        if (deleteError) {

            console.error('Could not delete event:', deleteError);

            await interaction.reply(
                '❌ Something went wrong while deleting the event.'
            );

            return;
        }


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


        const { data: event, error: findError } = await supabase
            .from('events')
            .select('*')
            .eq('id', id)
            .eq('guild_id', interaction.guildId)
            .maybeSingle();


        if (findError) {

            console.error('Could not find event:', findError);

            await interaction.reply(
                '❌ Something went wrong while finding the event.'
            );

            return;
        }


        if (!event) {

            await interaction.reply(
                `❌ I couldn't find Event ID \`${id}\`.`
            );

            return;
        }


        const { error: updateError } = await supabase
            .from('events')
            .update({
                date: date,
                name: name,
                description: description
            })
            .eq('id', id)
            .eq('guild_id', interaction.guildId);


        if (updateError) {

            console.error('Could not update event:', updateError);

            await interaction.reply(
                '❌ Something went wrong while editing the event.'
            );

            return;
        }


        await updateCalendar(interaction.guild);


        await interaction.reply(
            `✏️ Updated Event ID \`${id}\`!\n**${name}** is now scheduled for **${date}**.`
        );

        return;
    }

});


// ============================
// Start the bot
// ============================

registerCommands();

client.login(process.env.DISCORD_TOKEN);