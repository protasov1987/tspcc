package ru.tspcc.chat.ui.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import ru.tspcc.chat.R
import ru.tspcc.chat.model.MessageDto
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.DateTimeParseException
import java.util.Locale

class MessagesAdapter(
    private val currentUserId: String?
) : RecyclerView.Adapter<RecyclerView.ViewHolder>() {

    private val items = mutableListOf<ChatItem>()
    private var lastDeliveredSeq: Int = 0
    private var lastReadSeq: Int = 0
    private var lastDate: LocalDate? = null

    private val timeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale("ru", "RU"))
    private val dateFormatter = DateTimeFormatter.ofPattern("dd.MM.yyyy", Locale("ru", "RU"))

    fun submitList(list: List<MessageDto>) {
        val oldSize = items.size
        items.clear()
        lastDate = null
        list.forEach { message ->
            appendInternal(message)
        }
        if (oldSize > 0) {
            notifyItemRangeRemoved(0, oldSize)
        }
        if (items.isNotEmpty()) {
            notifyItemRangeInserted(0, items.size)
        }
    }

    fun append(message: MessageDto) {
        val start = items.size
        val addedCount = appendInternal(message)
        if (addedCount > 0) {
            notifyItemRangeInserted(start, addedCount)
        }
    }

    fun updateState(lastDelivered: Int, lastRead: Int) {
        val updated = lastDelivered != lastDeliveredSeq || lastRead != lastReadSeq
        lastDeliveredSeq = lastDelivered
        lastReadSeq = lastRead
        if (updated) {
            if (items.isNotEmpty()) {
                notifyItemRangeChanged(0, items.size)
            }
        }
    }

    fun getLastSeq(): Int {
        return items.asSequence()
            .filterIsInstance<ChatItem.MessageItem>()
            .maxOfOrNull { it.message.seq } ?: 0
    }

    override fun getItemViewType(position: Int): Int {
        return when (val item = items[position]) {
            is ChatItem.DateItem -> 2
            is ChatItem.MessageItem -> if (item.message.senderId == currentUserId) 1 else 0
        }
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): RecyclerView.ViewHolder {
        return if (viewType == 2) {
            val view = LayoutInflater.from(parent.context).inflate(R.layout.item_message_date, parent, false)
            DateViewHolder(view)
        } else {
            val layout = if (viewType == 1) R.layout.item_message_right else R.layout.item_message_left
            val view = LayoutInflater.from(parent.context).inflate(layout, parent, false)
            MessageViewHolder(view)
        }
    }

    override fun onBindViewHolder(holder: RecyclerView.ViewHolder, position: Int) {
        when (holder) {
            is MessageViewHolder -> holder.bind((items[position] as ChatItem.MessageItem).message)
            is DateViewHolder -> holder.bind((items[position] as ChatItem.DateItem).label)
        }
    }

    override fun getItemCount(): Int = items.size

    inner class MessageViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val textView: TextView = itemView.findViewById(R.id.messageText)
        private val metaView: TextView = itemView.findViewById(R.id.messageMeta)

        fun bind(item: MessageDto) {
            textView.text = item.text
            val timeText = formatTime(item.createdAt)
            val status = getStatusIcon(item)
            metaView.text = when {
                status.isNotBlank() && timeText.isNotBlank() -> "$timeText $status"
                status.isNotBlank() -> status
                else -> timeText
            }
        }

        private fun getStatusIcon(item: MessageDto): String {
            if (item.senderId != currentUserId) return ""
            val seq = item.seq
            if (seq <= 0) return "✓"
            return when {
                lastReadSeq >= seq -> "✓✓"
                lastDeliveredSeq >= seq -> "✓✓"
                else -> "✓"
            }
        }
    }

    class DateViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        private val dateView: TextView = itemView.findViewById(R.id.messageDate)

        fun bind(label: String) {
            dateView.text = label
        }
    }

    private fun appendInternal(message: MessageDto): Int {
        var added = 0
        val date = parseLocalDate(message.createdAt)
        if (date != null && date != lastDate) {
            val label = formatDateLabel(date)
            items.add(ChatItem.DateItem(date, label))
            lastDate = date
            added += 1
        }
        items.add(ChatItem.MessageItem(message))
        added += 1
        return added
    }

    private fun formatTime(value: String?): String {
        val instant = parseInstant(value) ?: return ""
        return timeFormatter.format(instant.atZone(ZoneId.systemDefault()).toLocalTime())
    }

    private fun formatDateLabel(date: LocalDate): String {
        return dateFormatter.format(date)
    }

    private fun parseLocalDate(value: String?): LocalDate? {
        val instant = parseInstant(value) ?: return null
        return instant.atZone(ZoneId.systemDefault()).toLocalDate()
    }

    private fun parseInstant(value: String?): Instant? {
        if (value.isNullOrBlank()) return null
        return try {
            Instant.parse(value)
        } catch (_: DateTimeParseException) {
            try {
                OffsetDateTime.parse(value).toInstant()
            } catch (_: DateTimeParseException) {
                try {
                    LocalDateTime.parse(value).atZone(ZoneId.systemDefault()).toInstant()
                } catch (_: DateTimeParseException) {
                    try {
                        val fallback = DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss")
                        LocalDateTime.parse(value, fallback).atZone(ZoneId.systemDefault()).toInstant()
                    } catch (_: DateTimeParseException) {
                        null
                    }
                }
            }
        }
    }

    private sealed class ChatItem {
        data class MessageItem(val message: MessageDto) : ChatItem()
        data class DateItem(val date: LocalDate, val label: String) : ChatItem()
    }
}
