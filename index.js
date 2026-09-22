require('dotenv').config();

const express = require('express');

const {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    SlashCommandBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    MessageFlags
} = require('discord.js');

const {
    createClient
} = require('@supabase/supabase-js');


// ============================================================
// ENVIRONMENT
// ============================================================

const requiredEnv = [
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'SUPABASE_URL',
    'SUPABASE_KEY'
];

for (const name of requiredEnv) {

    if (!process.env[name]) {

        console.error(
            `Missing required environment variable: ${name}`
        );

        process.exit(1);
    }
}

const TOKEN =
    process.env.DISCORD_TOKEN;

const CLIENT_ID =
    process.env.DISCORD_CLIENT_ID;

const SUPABASE_URL =
    process.env.SUPABASE_URL;

const SUPABASE_KEY =
    process.env.SUPABASE_KEY;


// ============================================================
// SETTINGS
// ============================================================

const EVENTS_CHANNEL_NAME = 'events';

const EVENTS_ROLE_ID =
    '1551044124550107157';

const PORT =
    process.env.PORT || 10000;


// ============================================================
// SUPABASE
// ============================================================

const supabase =
    createClient(
        SUPABASE_URL,
        SUPABASE_KEY
    );


// ============================================================
// DISCORD CLIENT
// ============================================================

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds
    ]
});


// ============================================================
// EXPRESS
// ============================================================

const app = express();


// ============================================================
// DATE HELPERS
// ============================================================

function getEasternToday() {

    return new Intl.DateTimeFormat(
        'en-CA',
        {
            timeZone: 'America/New_York',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit'
        }
    ).format(new Date());
}


function isValidDate(dateString) {

    if (
        !/^\d{4}-\d{2}-\d{2}$/.test(
            dateString
        )
    ) {
        return false;
    }

    const [
        year,
        month,
        day
    ] = dateString
        .split('-')
        .map(Number);

    const date =
        new Date(
            Date.UTC(
                year,
                month - 1,
                day
            )
        );

    return (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day
    );
}


function formatMonth(dateString) {

    const [
        year,
        month,
        day
    ] = dateString
        .split('-')
        .map(Number);

    const date =
        new Date(
            Date.UTC(
                year,
                month - 1,
                day
            )
        );

    return date.toLocaleDateString(
        'en-US',
        {
            month: 'long',
            year: 'numeric',
            timeZone: 'UTC'
        }
    );
}


function formatDay(dateString) {

    return dateString
        .split('-')[2]
        .replace(/^0/, '');
}


// ============================================================
// EVENT DATABASE FUNCTIONS
// ============================================================

async function getUpcomingEvents(
    guildId
) {

    const today =
        getEasternToday();

    const {
        data,
        error
    } =
        await supabase
            .from('events')
            .select('*')
            .eq(
                'guild_id',
                guildId
            )
            .gte(
                'date',
                today
            )
            .order(
                'date',
                {
                    ascending: true
                }
            )
            .order(
                'id',
                {
                    ascending: true
                }
            );

    if (error) {
        throw error;
    }

    return data || [];
}


// ============================================================
// BUILD THE 4-EVENT LIST
// ============================================================

function buildUpcomingMessage(
    events
) {

    let message =
        '📅 **UPCOMING EVENTS**\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n';

    if (
        !events ||
        events.length === 0
    ) {

        message +=
            '📭 **No upcoming events!**\n';

        return message;
    }

    const visibleEvents =
        events.slice(0, 4);

    let currentMonth = null;

    for (
        const event of visibleEvents
    ) {

        const month =
            formatMonth(
                event.date
            );

        if (
            month !== currentMonth
        ) {

            message +=
                `🗓️ **${month.toUpperCase()}**\n\n`;

            currentMonth =
                month;
        }

        message +=
            `**${formatDay(event.date)}** • ${event.name}\n`;

        message +=
            `   └─ ${event.description}\n\n`;
    }

    if (
        events.length > 4
    ) {

        message +=
            `📋 **+ ${events.length - 4} more upcoming events**\n`;
    }

    return message;
}


// ============================================================
// BUILD FULL EVENT LIST
// ============================================================

function buildFullEventList(
    events
) {

    let message =
        '📋 **FULL UPCOMING EVENT LIST**\n' +
        '━━━━━━━━━━━━━━━━━━━━\n\n';

    for (
        const event of events
    ) {

        message +=
            `**${event.date}** • ${event.name}\n`;

        message +=
            `   └─ ${event.description}\n`;

        message +=
            `   └─ Event ID: \`${event.id}\`\n\n`;
    }

    return message;
}


// ============================================================
// SPLIT LONG DISCORD MESSAGES
// ============================================================

function splitMessage(
    message
) {

    const maxLength = 1900;

    if (
        message.length <= maxLength
    ) {
        return [message];
    }

    const chunks = [];

    let remaining =
        message;

    while (
        remaining.length > maxLength
    ) {

        let splitAt =
            remaining.lastIndexOf(
                '\n',
                maxLength
            );

        if (
            splitAt <= 0
        ) {
            splitAt =
                maxLength;
        }

        chunks.push(
            remaining.substring(
                0,
                splitAt
            )
        );

        remaining =
            remaining.substring(
                splitAt
            ).trimStart();
    }

    if (
        remaining.length > 0
    ) {
        chunks.push(remaining);
    }

    return chunks;
}


// ============================================================
// FULL LIST BUTTON
// ============================================================

function makeFullListButton() {

    return new ButtonBuilder()
        .setCustomId(
            'view_full_event_list'
        )
        .setLabel(
            'View Full Event List'
        )
        .setEmoji('📋')
        .setStyle(
            ButtonStyle.Primary
        );
}


function makeButtonRow() {

    return new ActionRowBuilder()
        .addComponents(
            makeFullListButton()
        );
}


// ============================================================
// REMINDERS
// ============================================================

async function checkReminders() {

    const today =
        getEasternToday();

    try {

        // Delete events that are in the past.

        const {
            error: deleteError
        } =
            await supabase
                .from('events')
                .delete()
                .lt(
                    'date',
                    today
                );

        if (deleteError) {

            console.error(
                'Could not delete old events:',
                deleteError
            );
        }


        // Find events happening today.

        const {
            data: events,
            error
        } =
            await supabase
                .from('events')
                .select('*')
                .eq(
                    'date',
                    today
                );

        if (error) {

            console.error(
                'Could not load today events:',
                error
            );

            return;
        }

        if (
            !events ||
            events.length === 0
        ) {
            return;
        }


        for (
            const event of events
        ) {

            // Check whether the reminder was
            // already sent.

            const {
                data: alreadySent,
                error:
                    reminderLookupError
            } =
                await supabase
                    .from(
                        'event_reminders'
                    )
                    .select(
                        'event_id'
                    )
                    .eq(
                        'event_id',
                        event.id
                    )
                    .maybeSingle();

            if (
                reminderLookupError
            ) {

                console.error(
                    `Could not check reminder for event ${event.id}:`,
                    reminderLookupError
                );

                continue;
            }

            if (alreadySent) {
                continue;
            }


            // Find the Discord server.

            const guild =
                client.guilds.cache.get(
                    event.guild_id
                );

            if (!guild) {

                console.log(
                    `Guild ${event.guild_id} is not currently available.`
                );

                continue;
            }


            // Find the #events channel.

            const channel =
                guild.channels.cache.find(
                    channel =>
                        channel.isTextBased() &&
                        channel.name ===
                            EVENTS_CHANNEL_NAME
                );

            if (!channel) {

                console.log(
                    `[${guild.name}] #${EVENTS_CHANNEL_NAME} channel not found for reminder.`
                );

                continue;
            }


            // Build reminder.

            let reminder =
                `<@&${EVENTS_ROLE_ID}>\n\n` +
                '🔔 **EVENT REMINDER**\n\n' +
                `**${event.name}** is happening today!\n` +
                `📝 ${event.description}`;


            // Send reminder.

            await channel.send({
                content: reminder
            });


            // Record that reminder was sent.

            const {
                error: insertError
            } =
                await supabase
                    .from(
                        'event_reminders'
                    )
                    .insert({
                        event_id:
                            event.id,

                        sent_at:
                            new Date().toISOString()
                    });

            if (insertError) {

                console.error(
                    `Could not record reminder for event ${event.id}:`,
                    insertError
                );
            }
        }

    } catch (error) {

        console.error(
            'checkReminders failed:',
            error
        );
    }
}


// ============================================================
// SLASH COMMANDS
// ============================================================

const commands = [

    new SlashCommandBuilder()
        .setName('event')
        .setDescription(
            'Manage server events'
        )

        // ----------------------------------------------------
        // /event add
        // ----------------------------------------------------

        .addSubcommand(
            subcommand =>
                subcommand
                    .setName('add')
                    .setDescription(
                        'Create a new event'
                    )

                    .addStringOption(
                        option =>
                            option
                                .setName('date')
                                .setDescription(
                                    'Event date (YYYY-MM-DD)'
                                )
                                .setRequired(true)
                    )

                    .addStringOption(
                        option =>
                            option
                                .setName('name')
                                .setDescription(
                                    'Event name'
                                )
                                .setRequired(true)
                    )

                    .addStringOption(
                        option =>
                            option
                                .setName('description')
                                .setDescription(
                                    'Event description'
                                )
                                .setRequired(true)
                    )
        )

        // ----------------------------------------------------
        // /event list
        // ----------------------------------------------------

        .addSubcommand(
            subcommand =>
                subcommand
                    .setName('list')
                    .setDescription(
                        'Show the 4 closest upcoming events'
                    )
        )

        // ----------------------------------------------------
        // /event delete
        // ----------------------------------------------------

        .addSubcommand(
            subcommand =>
                subcommand
                    .setName('delete')
                    .setDescription(
                        'Delete an event'
                    )

                    .addIntegerOption(
                        option =>
                            option
                                .setName('id')
                                .setDescription(
                                    'Event ID'
                                )
                                .setRequired(true)
                    )
        )

        // ----------------------------------------------------
        // /event edit
        // ----------------------------------------------------

        .addSubcommand(
            subcommand =>
                subcommand
                    .setName('edit')
                    .setDescription(
                        'Edit an event'
                    )

                    .addIntegerOption(
                        option =>
                            option
                                .setName('id')
                                .setDescription(
                                    'Event ID'
                                )
                                .setRequired(true)
                    )

                    .addStringOption(
                        option =>
                            option
                                .setName('date')
                                .setDescription(
                                    'New event date (YYYY-MM-DD)'
                                )
                                .setRequired(true)
                    )

                    .addStringOption(
                        option =>
                            option
                                .setName('name')
                                .setDescription(
                                    'New event name'
                                )
                                .setRequired(true)
                    )

                    .addStringOption(
                        option =>
                            option
                                .setName('description')
                                .setDescription(
                                    'New event description'
                                )
                                .setRequired(true)
                    )
        )

].map(
    command =>
        command.toJSON()
);


// ============================================================
// REGISTER SLASH COMMANDS
// ============================================================

async function registerCommands() {

    const rest =
        new REST({
            version: '10'
        }).setToken(
            TOKEN
        );

    console.log(
        'Registering commands...'
    );

    await rest.put(
    Routes.applicationGuildCommands(
        CLIENT_ID,
        process.env.GUILD_ID
    ),
    {
        body: commands
    }
);

    console.log(
        'Commands registered!'
    );
}


// ============================================================
// BOT READY
// ============================================================

client.once(
    'clientReady',
    async () => {

        console.log(
            'Server Calendar is online!'
        );

        client.user.setActivity(
            'Developed by OogaBoogaBob',
            {
                type: 0
            }
        );

        try {

            await registerCommands();

        } catch (error) {

            console.error(
                'Failed to register commands:',
                error
            );
        }
    }
);


// ============================================================
// INTERACTION HANDLER
// ============================================================

client.on(
    'interactionCreate',
    async interaction => {

        // ====================================================
        // FULL EVENT LIST BUTTON
        // ====================================================

        if (
            interaction.isButton() &&
            interaction.customId ===
                'view_full_event_list'
        ) {

            console.log(
                'Full event list button clicked.'
            );

            try {

                // Respond immediately so Discord
                // does not time out.

                await interaction.reply({
                    content:
                        '⏳ Loading full event list...',
                    flags:
                        MessageFlags.Ephemeral
                });


                // Load all upcoming events.

                const events =
                    await getUpcomingEvents(
                        interaction.guildId
                    );


                if (
                    events.length === 0
                ) {

                    await interaction.editReply({
                        content:
                            '📭 **There are no upcoming events!**'
                    });

                    return;
                }


                const fullMessage =
                    buildFullEventList(
                        events
                    );


                const chunks =
                    splitMessage(
                        fullMessage
                    );


                // Show first chunk.

                await interaction.editReply({
                    content:
                        chunks[0]
                });


                // Send remaining chunks privately.

                for (
                    let i = 1;
                    i < chunks.length;
                    i++
                ) {

                    await interaction.followUp({
                        content:
                            chunks[i],
                        flags:
                            MessageFlags.Ephemeral
                    });
                }

            } catch (error) {

                console.error(
                    'Button interaction error:',
                    error
                );

                try {

                    if (
                        interaction.replied
                    ) {

                        await interaction.editReply({
                            content:
                                '❌ Something went wrong while loading the events.'
                        });

                    } else {

                        await interaction.reply({
                            content:
                                '❌ Something went wrong while loading the events.',
                            flags:
                                MessageFlags.Ephemeral
                        });
                    }

                } catch (replyError) {

                    console.error(
                        'Could not send button error:',
                        replyError
                    );
                }
            }

            return;
        }


        // ====================================================
        // ONLY CONTINUE FOR SLASH COMMANDS
        // ====================================================

        if (
            !interaction.isChatInputCommand()
        ) {
            return;
        }

        if (
            interaction.commandName !==
            'event'
        ) {
            return;
        }


        const subcommand =
            interaction.options.getSubcommand();


        // ====================================================
        // /event add
        // ====================================================

        if (
            subcommand === 'add'
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
                );


            // Validate date.

            if (
                !isValidDate(date)
            ) {

                await interaction.reply({
                    content:
                        '❌ Invalid date. Use a real date in YYYY-MM-DD format.',
                    flags:
                        MessageFlags.Ephemeral
                });

                return;
            }


            // Validate text.

            if (
                !name ||
                !name.trim()
            ) {

                await interaction.reply({
                    content:
                        '❌ Event name cannot be empty.',
                    flags:
                        MessageFlags.Ephemeral
                });

                return;
            }

            if (
                !description ||
                !description.trim()
            ) {

                await interaction.reply({
                    content:
                        '❌ Event description cannot be empty.',
                    flags:
                        MessageFlags.Ephemeral
                });

                return;
            }


            try {

                const {
                    data: event,
                    error
                } =
                    await supabase
                        .from('events')
                        .insert({
                            guild_id:
                                interaction.guildId,

                            name:
                                name.trim(),

                            date,

                            description:
                                description.trim(),

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

                    await interaction.reply({
                        content:
                            '❌ Could not add the event.',
                        flags:
                            MessageFlags.Ephemeral
                    });

                    return;
                }


                await interaction.reply({
                    content:
                        `✅ Added **${event.name}**\n` +
                        `📅 ${event.date}\n` +
                        `📝 ${event.description}\n` +
                        `🆔 Event ID: \`${event.id}\``,
                    flags:
                        MessageFlags.Ephemeral
                });

            } catch (error) {

                console.error(
                    'Add event error:',
                    error
                );

                if (
                    !interaction.replied
                ) {

                    await interaction.reply({
                        content:
                            '❌ Something went wrong while adding the event.',
                        flags:
                            MessageFlags.Ephemeral
                    });
                }
            }

            return;
        }


        // ====================================================
        // /event list
        // ====================================================

        if (
            subcommand === 'list'
        ) {

            try {

                const events =
                    await getUpcomingEvents(
                        interaction.guildId
                    );


                const message =
                    buildUpcomingMessage(
                        events
                    );


                const row =
                    makeButtonRow();


                await interaction.reply({
                    content:
                        message,
                    components: [
                        row
                    ]
                });

            } catch (error) {

                console.error(
                    'Event list error:',
                    error
                );

                await interaction.reply({
                    content:
                        '❌ Something went wrong while loading the events.',
                    flags:
                        MessageFlags.Ephemeral
                });
            }

            return;
        }


        // ====================================================
        // /event delete
        // ====================================================

        if (
            subcommand === 'delete'
        ) {

            const id =
                interaction.options.getInteger(
                    'id'
                );


            try {

                const {
                    data: existingEvent,
                    error: findError
                } =
                    await supabase
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

                    await interaction.reply({
                        content:
                            '❌ Could not find that event.',
                        flags:
                            MessageFlags.Ephemeral
                    });

                    return;
                }


                if (
                    !existingEvent
                ) {

                    await interaction.reply({
                        content:
                            `❌ No event with ID \`${id}\` was found.`,
                        flags:
                            MessageFlags.Ephemeral
                    });

                    return;
                }


                const {
                    error
                } =
                    await supabase
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


                if (error) {

                    console.error(
                        'Could not delete event:',
                        error
                    );

                    await interaction.reply({
                        content:
                            '❌ Could not delete the event.',
                        flags:
                            MessageFlags.Ephemeral
                    });

                    return;
                }


                // Remove any reminder record.

                await supabase
                    .from('event_reminders')
                    .delete()
                    .eq(
                        'event_id',
                        id
                    );


                await interaction.reply({
                    content:
                        `🗑️ Deleted **${existingEvent.name}**`,
                    flags:
                        MessageFlags.Ephemeral
                });

            } catch (error) {

                console.error(
                    'Delete event error:',
                    error
                );

                if (
                    !interaction.replied
                ) {

                    await interaction.reply({
                        content:
                            '❌ Something went wrong while deleting the event.',
                        flags:
                            MessageFlags.Ephemeral
                    });
                }
            }

            return;
        }


        // ====================================================
        // /event edit
        // ====================================================

        if (
            subcommand === 'edit'
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
                );


            // Validate date.

            if (
                !isValidDate(date)
            ) {

                await interaction.reply({
                    content:
                        '❌ Invalid date. Use a real date in YYYY-MM-DD format.',
                    flags:
                        MessageFlags.Ephemeral
                });

                return;
            }


            // Validate text.

            if (
                !name ||
                !name.trim()
            ) {

                await interaction.reply({
                    content:
                        '❌ Event name cannot be empty.',
                    flags:
                        MessageFlags.Ephemeral
                });

                return;
            }

            if (
                !description ||
                !description.trim()
            ) {

                await interaction.reply({
                    content:
                        '❌ Event description cannot be empty.',
                    flags:
                        MessageFlags.Ephemeral
                });

                return;
            }


            try {

                const {
                    data: existingEvent,
                    error: findError
                } =
                    await supabase
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

                    await interaction.reply({
                        content:
                            '❌ Could not find that event.',
                        flags:
                            MessageFlags.Ephemeral
                    });

                    return;
                }


                if (
                    !existingEvent
                ) {

                    await interaction.reply({
                        content:
                            `❌ No event with ID \`${id}\` was found.`,
                        flags:
                            MessageFlags.Ephemeral
                    });

                    return;
                }


                const {
                    data: updatedEvent,
                    error
                } =
                    await supabase
                        .from('events')
                        .update({
                            date,

                            name:
                                name.trim(),

                            description:
                                description.trim()
                        })
                        .eq(
                            'id',
                            id
                        )
                        .eq(
                            'guild_id',
                            interaction.guildId
                        )
                        .select()
                        .single();


                if (error) {

                    console.error(
                        'Could not edit event:',
                        error
                    );

                    await interaction.reply({
                        content:
                            '❌ Could not edit the event.',
                        flags:
                            MessageFlags.Ephemeral
                    });

                    return;
                }


                // Remove the old reminder record.
                // This allows the event to receive a new
                // reminder if its date is changed.

                await supabase
                    .from('event_reminders')
                    .delete()
                    .eq(
                        'event_id',
                        id
                    );


                await interaction.reply({
                    content:
                        `✏️ Edited **${updatedEvent.name}**\n` +
                        `📅 ${updatedEvent.date}\n` +
                        `📝 ${updatedEvent.description}\n` +
                        `🆔 Event ID: \`${updatedEvent.id}\``,
                    flags:
                        MessageFlags.Ephemeral
                });

            } catch (error) {

                console.error(
                    'Edit event error:',
                    error
                );

                if (
                    !interaction.replied
                ) {

                    await interaction.reply({
                        content:
                            '❌ Something went wrong while editing the event.',
                        flags:
                            MessageFlags.Ephemeral
                    });
                }
            }

            return;
        }
    }
);


// ============================================================
// LOGIN TO DISCORD
// ============================================================

client.login(
    TOKEN
).catch(
    error => {

        console.error(
            'Failed to log in to Discord:',
            error
        );

    }
);


// ============================================================
// WEB SERVER
// ============================================================

app.get(
    '/',
    async (req, res) => {

        try {

            // Cron-job.org hits this route every
            // 10 minutes. This keeps Render awake
            // and checks for event reminders.

            await checkReminders();

            res
                .status(200)
                .send(
                    'Server Calendar is online!'
                );

        } catch (error) {

            console.error(
                'Reminder check failed:',
                error
            );

            res
                .status(500)
                .send(
                    'Server Calendar is online, but the reminder check failed.'
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
