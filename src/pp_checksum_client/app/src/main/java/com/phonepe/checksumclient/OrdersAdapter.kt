package com.phonepe.checksumclient

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.phonepe.checksumclient.databinding.ItemOrderBinding

class OrdersAdapter : RecyclerView.Adapter<OrdersAdapter.ViewHolder>() {
    private val items = ArrayList<Order>()

    fun submit(list: List<Order>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemOrderBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    class ViewHolder(private val binding: ItemOrderBinding) : RecyclerView.ViewHolder(binding.root) {
        fun bind(order: Order) {
            binding.orderId.text = order.id
            binding.orderStatus.text = order.status
            binding.orderAmount.text = "${order.currency} ${order.amount}"
            binding.orderTime.text = order.createdAt
        }
    }
}
