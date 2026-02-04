package com.phonepe.checksumclient

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.core.content.ContextCompat
import androidx.recyclerview.widget.RecyclerView
import com.phonepe.checksumclient.databinding.ItemOrderOpenBinding

class OpenOrdersAdapter(
    private val onClaim: (Order) -> Unit
) : RecyclerView.Adapter<OpenOrdersAdapter.ViewHolder>() {
    private val items = ArrayList<Order>()

    fun submit(list: List<Order>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemOrderOpenBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding, onClaim)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    class ViewHolder(
        private val binding: ItemOrderOpenBinding,
        private val onClaim: (Order) -> Unit
    ) : RecyclerView.ViewHolder(binding.root) {

        fun bind(order: Order) {
            binding.openOrderId.text = order.id
            binding.openOrderAmount.text = "${order.currency} ${order.amount}"
            binding.openOrderTime.text = formatTime(order.createdAt)
            binding.openOrderClaim.setOnClickListener { onClaim(order) }
        }

        private fun formatTime(value: String): String {
            return try {
                val instant = java.time.Instant.parse(value)
                val zone = java.time.ZoneId.systemDefault()
                val fmt = java.time.format.DateTimeFormatter.ofPattern("MMM d, HH:mm").withZone(zone)
                fmt.format(instant)
            } catch (e: Exception) {
                value
            }
        }
    }
}
