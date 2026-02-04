package com.phonepe.checksumclient

data class LoginResult(
    val token: String,
    val expiresAt: Long,
    val user: UserProfile
)

data class UserProfile(
    val username: String,
    val name: String,
    val phone: String,
    val email: String
)

data class Order(
    val id: String,
    val amount: Double,
    val currency: String,
    val status: String,
    val createdAt: String,
    val paymentApp: String,
    val assignedTo: String?,
    val claimedAt: String?,
    val claimExpiresAt: Long?
)

data class Earning(
    val id: String,
    val amount: Double,
    val currency: String,
    val note: String,
    val createdAt: String
)

data class EarningsResponse(
    val total: Double,
    val earnings: List<Earning>
)
