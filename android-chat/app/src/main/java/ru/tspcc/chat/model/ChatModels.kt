package ru.tspcc.chat.model

data class LoginResponse(
    val success: Boolean = false,
    val user: UserDto? = null,
    val csrfToken: String? = null,
    val error: String? = null
)

data class SessionResponse(
    val user: UserDto? = null,
    val csrfToken: String? = null,
    val error: String? = null
)

data class UsersResponse(
    val users: List<UserDto> = emptyList()
)

data class DirectResponse(
    val conversationId: String? = null,
    val error: String? = null
)

data class MessagesResponse(
    val messages: List<MessageDto> = emptyList(),
    val states: Map<String, ChatStateDto> = emptyMap(),
    val hasMore: Boolean = false
)

data class MessageResponse(
    val message: MessageDto? = null,
    val error: String? = null
)

data class UserDto(
    val id: String = "",
    val name: String? = null,
    val isOnline: Boolean? = null,
    val unreadCount: Int? = null,
    val messageCount: Int? = null,
    val hasHistory: Boolean? = null,
    val conversationId: String? = null
)

data class MessageDto(
    val id: String = "",
    val conversationId: String = "",
    val seq: Int = 0,
    val senderId: String = "",
    val text: String = "",
    val createdAt: String? = null,
    val clientMsgId: String? = null
)

data class ChatStateDto(
    val lastDeliveredSeq: Int? = null,
    val lastReadSeq: Int? = null
)
