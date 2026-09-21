
require('dotenv').config();

const express = require('express');
const app = express();

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    MessageFlags,
    ButtonBuilder,
    ButtonStyle
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

    if (!guild) return;

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

    // Only show the next 4 events
    const visibleEvents = (events || []).slice(0, 4);

    // Count events that are not being displayed
    const extraEvents = Math.max(
        (events || []).length - 4,
        0
    );

    if (visibleEvents.length === 0) {

        message += '📭 No events scheduled yet.';

    } else {

        let currentMonth = '';

        for (const event of visibleEvents) {

            const date = new Date(
                event.date + 'T00:00:00'
            );

            const month = date.toLocaleDateString(
                'en-US',
                {
                    month: 'long',
                    year: 'numeric'
                }
            );

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

        if (extraEvents > 0) {

            message +=
                `📋 **+ ${extraEvents} more upcoming events**\n`;
        }
    }


    // ============================
    // View Full Event List button
    // ============================

    const button = new ButtonBuilder()
        .setCustomId('view_full_event_list')
        .setLabel('View Full Event List')
        .setEmoji('📋')
        .setStyle(ButtonStyle.Primary);

    const row = new ActionRowBuilder()
        .addComponents(button);


    // ============================
    // Look for saved calendar message
    // ============================

    const {
        data: savedMessage,
        error: messageError
    } = await supabase
        .from('calendar_messages')
        .select('*')
        .eq('guild_id', guild.id)
        .maybeSingle();

    if (messageError) {

        console.error(
            'Could not find saved calendar message:',
            messageError
        );

        return;
    }


    // ============================
    // Edit existing calendar message
    // ============================

    if (savedMessage) {

        try {

            const calendarMessage =
                await calendarChannel.messages.fetch(
                    savedMessage.message_id
                );

            await calendarMessage.edit({
                content: message,
                components: [row]
            });

            return;

        } catch (error) {

            console.log(
                'Old calendar message could not be found. Creating a new one.'
            );
        }
    }


    // ============================
    // Create new calendar message
    // ============================

    const newMessage =
        await calendarChannel.send({
            content: message,
            components: [row]
        });


    const {
        error: saveMessageError
    } = await supabase
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
// Check reminders
// ============================

async function checkReminders() {

    const guild = client.guilds.cache.first();

    if (!guild) return;

    const channel = guild.channels.cache.find(
        channel => channel.name === 'events'
    );

    if (!channel) return;


    // ============================
    // Get today's date in Eastern Time
    // ============================

    const today = new Intl.DateTimeFormat(
        'en-CA',
        {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }
    ).format(new Date());


    // ============================
    // Remove events whose date has passed
    // ============================

    const {
        error: deleteError
    } = await supabase
        .from('events')
        .delete()
        .eq('guild_id', guild.id)
        .lt('date', today);

    if (deleteError) {

        console.error(
            'Error removing old events:',
            deleteError
        );
    }


    // ============================
    // Find events happening today
    // ============================

    const {
        data: events,
        error
    } = await supabase
        .from('events')
        .select('*')
        .eq('guild_id', guild.id)
        .eq('date', today);

    if (error) {

        console.error(
            'Error checking reminders:',
            error
        );

        return;
    }


    // ============================
    // Send reminders
    // ============================

    for (const event of events || []) {

        const {
            data: existingReminder,
            error: reminderCheckError
        } = await supabase
            .from('event_reminders')
            .select('event_id')
            .eq('event_id', event.id)
            .maybeSingle();


        if (reminderCheckError) {

            console.error(
                'Error checking reminder status:',
                reminderCheckError
            );

            continue;
        }


        if (existingReminder) continue;


        // Send reminder to Events Tags role
        await channel.send(
            `<@&1551044124550107157>\n\n` +
            `🔔 **EVENT REMINDER**\n\n` +
            `**${event.name}** is happening today!` +
            (
                event.description
                    ? `\n📝 ${event.description}`
                    : ''
            )
        );


        // Remember that reminder was sent
        const {
            error: reminderSaveError
        } = await supabase
            .from('event_reminders')
            .insert({
                event_id: event.id,
                sent_at: new Date().toISOString()
            });


        if (reminderSaveError) {

            console.error(
                'Could not save reminder status:',
                reminderSaveError
            );
        }
    }


    // Refresh calendar after cleanup
    await updateCalendar(guild);
}


// ============================
// /event command
// ============================

const commands = [

    new SlashCommandBuilder()
        .setName('event')
        .setDescription('Manage your server calendar')


        // ============================
        // /event add
        // ============================

        .addSubcommand(subcommand =>
            subcommand
                .setName('add')
                .setDescription(
                    'Add an event to the calendar'
                )

                .addStringOption(option =>
                    option
                        .setName('date')
                        .setDescription(
                            'Date (YYYY-MM-DD)'
                        )
                        .setRequired(true)
                )

                .addStringOption(option =>
                    option
                        .setName('name')
                        .setDescription(
                            'Name of the event'
                        )
                        .setRequired(true)
                )

                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription(
                            'Optional description'
                        )
                        .setRequired(false)
                )
        )


        // ============================
        // /event list
        // ============================

        .addSubcommand(subcommand =>
            subcommand
                .setName('list')
                .setDescription(
                    'Refresh the server calendar'
                )
        )


        // ============================
        // /event delete
        // ============================

        .addSubcommand(subcommand =>
            subcommand
                .setName('delete')
                .setDescription(
                    'Delete an event from the calendar'
                )

                .addIntegerOption(option =>
                    option
                        .setName('id')
                        .setDescription(
                            'The Event ID'
                        )
                        .setRequired(true)
                )
        )


        // ============================
        // /event edit
        // ============================

        .addSubcommand(subcommand =>
            subcommand
                .setName('edit')
                .setDescription(
                    'Edit an existing calendar event'
                )

                .addIntegerOption(option =>
                    option
                        .setName('id')
                        .setDescription(
                            'The Event ID'
                        )
                        .setRequired(true)
                )

                .addStringOption(option =>
                    option
                        .setName('date')
                        .setDescription(
                            'New date (YYYY-MM-DD)'
                        )
                        .setRequired(true)
                )

                .addStringOption(option =>
                    option
                        .setName('name')
                        .setDescription(
                            'New event name'
                        )
                        .setRequired(true)
                )

                .addStringOption(option =>
                    option
                        .setName('description')
                        .setDescription(
                            'New description'
                        )
                        .setRequired(false)
                )
        )

].map(command => command.toJSON());


// ============================
// Register Discord commands
// ============================

const rest = new REST({
    version: '10'
})
    .setToken(process.env.DISCORD_TOKEN);


async function registerCommands() {

    try {

        console.log(
            'Registering commands...'
        );


        await rest.put(
            Routes.applicationGuildCommands(
                process.env.CLIENT_ID,
                process.env.GUILD_ID
            ),
            {
                body: commands
            }
        );


        console.log(
            'Commands registered!'
        );

    } catch (error) {

        console.error(error);

    }
}


// ============================
// When the bot connects
// ============================

client.once('ready', async () => {

    console.log(
        'Server Calendar is online!'
    );


    client.user.setActivity(
        'Developed by OogaBoogaBob',
        {
            type: 0
        }
    );


    // Update the calendar when bot starts
    setTimeout(
        async () => {

            await updateCalendar(
                client.guilds.cache.first()
            );

        },
        3000
    );


    // Check reminders when bot starts
    setTimeout(
        async () => {

            await checkReminders();

        },
        5000
    );

});


// Check reminders every hour
setInterval(
    checkReminders,
    60 * 60 * 1000
);


// ============================
// Handle Discord interactions
// ============================

client.on(
    'interactionCreate',
    async interaction => {


        // ============================
        // View Full Event List button
        // ============================

        if (
            interaction.isButton() &&
            interaction.customId ===
                'view_full_event_list'
        ) {

            await interaction.deferReply({
                flags: MessageFlags.Ephemeral
            });


            const {
                data: events,
                error
            } = await supabase
                .from('events')
                .select('*')
                .eq(
                    'guild_id',
                    interaction.guildId
                )
                .order(
                    'date',
                    {
                        ascending: true
                    }
                );


            if (error) {

                console.error(
                    'Could not load full event list:',
                    error
                );


                await interaction.editReply({
    content: '❌ Something went wrong while loading the events.'
});

                return;
            }


            if (!events || events.length === 0) {

                await interaction.editReply({
    content: '📅 There are no upcoming events!'
});

                return;
            }


            let message =
                '📋 **FULL UPCOMING EVENT LIST**\n\n';


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


            // Prevent an overly long Discord message
            if (message.length > 1900) {

                message =
                    message.substring(
                        0,
                        1900
                    ) +
                    '\n\n...and more events.';

            }


            await interaction.editReply(
                message
            );

            return;
        }


        // ============================
        // Ignore anything that isn't
        // a slash command
        // ============================

        if (!interaction.isChatInputCommand()) {
            return;
        }


        if (
            interaction.commandName !==
            'event'
        ) {
            return;
        }


        // ============================
        // /event add
        // ============================

        if (
            interaction.options.getSubcommand() ===
            'add'
        ) {

            const date =
                interaction.options.getString(
                    'date'
                );


            const name =
                interaction.options.getString(
                    'name'
                );


            const description =
                interaction.options.getString(
                    'description'
                ) || '';


            if (
                !/^\d{4}-\d{2}-\d{2}$/.test(
                    date
                )
            ) {

                await interaction.reply(
                    '❌ Please use the date format YYYY-MM-DD.'
                );

                return;
            }


            const {
                data: event,
                error
            } = await supabase
                .from('events')
                .insert({
                    guild_id:
                        interaction.guildId,
                    name:
                        name,
                    date:
                        date,
                    description:
                        description,
                    created_by:
                        interaction.user.id,
                    created_at:
                        new Date().toISOString()
                })
                .select()
                .single();


            if (error) {

                console.error(
                    'Could not add event:',
                    error
                );


                await interaction.reply(
                    '❌ Something went wrong while adding the event.'
                );

                return;
            }


            await updateCalendar(
                interaction.guild
            );


            await interaction.reply(
                `✅ Added **${name}** for **${date}**!\n` +
                `Event ID: \`${event.id}\``
            );


            return;
        }


        // ============================
        // /event list
        // ============================

        if (
    interaction.options.getSubcommand() ===
    'list'
) {

    const { data: events, error } = await supabase
        .from('events')
        .select('*')
        .eq('guild_id', interaction.guild.id)
        .order('date', { ascending: true });

    if (error) {

        console.error(
            'Could not load events:',
            error
        );

        await interaction.reply(
            '❌ Could not load the events.'
        );

        return;
    }

    let message =
        '📅 **SERVER EVENTS CALENDAR**\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n';

    let currentMonth = '';

const extraEvents = Math.max(
    (events || []).length - 4,
    0
);

    for (const event of (events || []).slice(0, 4)) {

        const date = new Date(
            event.date + 'T00:00:00'
        );

        const month = date
            .toLocaleDateString(
                'en-US',
                {
                    month: 'long',
                    year: 'numeric'
                }
            )
            .toUpperCase();

        if (month !== currentMonth) {

            currentMonth = month;

            message +=
                `🗓️ **${month}**\n\n`;
        }

        const day = date.getDate();

        message +=
            `**${day}** • ${event.name}\n`;

        if (event.description) {

            message +=
                `└─ ${event.description}\n`;
        }

        message += '\n';
    }

    if (!events || events.length === 0) {

        message +=
            'No upcoming events scheduled.\n';
    }

if (extraEvents > 0) {
    message +=
        `📋 **+ ${extraEvents} more upcoming events**\n\n`;
}

    const button = new ButtonBuilder()
    .setCustomId('view_full_event_list')
    .setLabel('View Full Event List')
    .setEmoji('📋')
    .setStyle(ButtonStyle.Primary);

const row = new ActionRowBuilder()
    .addComponents(button);

await interaction.reply({

    content: message,

    components: [row]

});

    return;
}


        // ============================
        // /event delete
        // ============================

        if (
            interaction.options.getSubcommand() ===
            'delete'
        ) {

            const id =
                interaction.options.getInteger(
                    'id'
                );


            const {
                data: event,
                error: findError
            } = await supabase
                .from('events')
                .select('*')
                .eq(
                    'id',
                    id
                )
                .eq(
                    'guild_id',
                    interaction.guildId
                )
                .maybeSingle();


            if (findError) {

                console.error(
                    'Could not find event:',
                    findError
                );


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


            const {
                error: deleteError
            } = await supabase
                .from('events')
                .delete()
                .eq(
                    'id',
                    id
                )
                .eq(
                    'guild_id',
                    interaction.guildId
                );


            if (deleteError) {

                console.error(
                    'Could not delete event:',
                    deleteError
                );


                await interaction.reply(
                    '❌ Something went wrong while deleting the event.'
                );

                return;
            }


            await updateCalendar(
                interaction.guild
            );


            await interaction.reply(
                `🗑️ Deleted **${event.name}** (${event.date}).`
            );


            return;
        }


        // ============================
        // /event edit
        // ============================

        if (
            interaction.options.getSubcommand() ===
            'edit'
        ) {

            const id =
                interaction.options.getInteger(
                    'id'
                );


            const date =
                interaction.options.getString(
                    'date'
                );


            const name =
                interaction.options.getString(
                    'name'
                );


            const description =
                interaction.options.getString(
                    'description'
                ) || '';


            if (
                !/^\d{4}-\d{2}-\d{2}$/.test(
                    date
                )
            ) {

                await interaction.reply(
                    '❌ Please use the date format YYYY-MM-DD.'
                );

                return;
            }


            const {
                data: event,
                error: findError
            } = await supabase
                .from('events')
                .select('*')
                .eq(
                    'id',
                    id
                )
                .eq(
                    'guild_id',
                    interaction.guildId
                )
                .maybeSingle();


            if (findError) {

                console.error(
                    'Could not find event:',
                    findError
                );


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


            const {
                error: updateError
            } = await supabase
                .from('events')
                .update({
                    date:
                        date,
                    name:
                        name,
                    description:
                        description
                })
                .eq(
                    'id',
                    id
                )
                .eq(
                    'guild_id',
                    interaction.guildId
                );


            if (updateError) {

                console.error(
                    'Could not update event:',
                    updateError
                );


                await interaction.reply(
                    '❌ Something went wrong while editing the event.'
                );

                return;
            }


            await updateCalendar(
                interaction.guild
            );


            await interaction.reply(
                `✏️ Updated Event ID \`${id}\`!\n` +
                `**${name}** is now scheduled for **${date}**.`
            );


            return;
        }

    }
);


// ============================
// Start the bot
// ============================

registerCommands();

client.login(
    process.env.DISCORD_TOKEN
);


// ============================
// Web server for Render
// ============================

const PORT =
    process.env.PORT || 3000;


app.get(
    '/',
    async (req, res) => {

        try {

            const guild =
                client.guilds.cache.first();


            if (guild) {

                await checkReminders();

            }


            res.send(
                'Server Calendar is online!'
            );

        } catch (error) {

            console.error(
                'Error during web refresh:',
                error
            );


            res.status(500).send(
                'Server Calendar is online, but refresh failed.'
            );

        }

    }
);


app.listen(
    PORT,
    () => {

        console.log(
            `Web server listening on port ${PORT}`
        );

    }
);
