package ru.tspcc.chat.ui.adapters

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import ru.tspcc.chat.R
import ru.tspcc.chat.ConversationsActivity
import ru.tspcc.chat.model.UserDto
import java.text.Collator
import java.util.Locale

class ConversationsAdapter(
    private val onClick: (UserDto) -> Unit
) : RecyclerView.Adapter<ConversationsAdapter.ViewHolder>() {

    private val items = mutableListOf<UserDto>()

    fun submitList(list: List<UserDto>) {
        val usersList = list.toMutableList()
        val systemUser = usersList.firstOrNull { it.id == ConversationsActivity.SYSTEM_ID }
        val others = usersList.filter { it.id != ConversationsActivity.SYSTEM_ID }
        val collator = Collator.getInstance(Locale("ru", "RU"))

        val sortFn = compareBy<UserDto>(
            { (it.unreadCount ?: 0) <= 0 },
            { -(it.messageCount ?: 0) }
        ).thenComparator { a, b ->
            collator.compare(a.name ?: "", b.name ?: "")
        }

        val sortedOthers = others.sortedWith(sortFn)
        val sorted = if (systemUser != null) {
            val systemUnread = (systemUser.unreadCount ?: 0) > 0
            if (!systemUnread) {
                listOf(systemUser) + sortedOthers
            } else {
                (listOf(systemUser) + sortedOthers).sortedWith(sortFn)
            }
        } else {
            sortedOthers
        }

        items.clear()
        items.addAll(sorted)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val view = LayoutInflater.from(parent.context).inflate(R.layout.item_conversation, parent, false)
        return ViewHolder(view, onClick)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    class ViewHolder(itemView: View, private val onClick: (UserDto) -> Unit) : RecyclerView.ViewHolder(itemView) {
        private val nameView: TextView = itemView.findViewById(R.id.conversationName)
        private val statusView: TextView = itemView.findViewById(R.id.conversationStatus)
        private val unreadView: TextView = itemView.findViewById(R.id.unreadBadge)

        fun bind(item: UserDto) {
            nameView.text = item.name ?: item.id
            val statusText = when (item.isOnline) {
                true -> "в сети"
                false -> "не в сети"
                else -> ""
            }
            statusView.text = statusText
            val statusColor = when (item.isOnline) {
                true -> R.color.teal_200
                else -> R.color.gray_700
            }
            statusView.setTextColor(itemView.context.getColor(statusColor))

            val unread = item.unreadCount ?: 0
            if (unread > 0) {
                unreadView.visibility = View.VISIBLE
                unreadView.text = unread.toString()
            } else {
                unreadView.visibility = View.GONE
            }

            itemView.setOnClickListener { onClick(item) }
        }
    }
}
