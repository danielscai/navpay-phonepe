package com.phonepe.checksumclient

import android.os.CountDownTimer
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.content.ContextCompat
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

    override fun onViewRecycled(holder: ViewHolder) {
        super.onViewRecycled(holder)
        holder.clearTimer()
    }

    override fun getItemCount(): Int = items.size

    class ViewHolder(private val binding: ItemOrderBinding) : RecyclerView.ViewHolder(binding.root) {
        private var timer: CountDownTimer? = null

        fun bind(order: Order) {
            binding.orderId.text = order.id
            binding.orderStatus.text = order.status
            binding.orderAmount.text = "${order.currency} ${order.amount}"
            binding.orderTime.text = order.createdAt
            binding.orderApp.text = "App: ${order.paymentApp}"
            applyStatusColor(order.status)
            bindCountdown(order)
        }

        private fun applyStatusColor(status: String) {
            val ctx = binding.root.context
            val color = when (status) {
                "UNASSIGNED" -> ContextCompat.getColor(ctx, R.color.status_neutral)
                "CLAIMED" -> ContextCompat.getColor(ctx, R.color.status_claimed)
                "PAID" -> ContextCompat.getColor(ctx, R.color.status_paid)
                "REFUNDED" -> ContextCompat.getColor(ctx, R.color.status_refunded)
                "PENDING_PAYMENT" -> ContextCompat.getColor(ctx, R.color.status_pending)
                else -> ContextCompat.getColor(ctx, R.color.status_neutral)
            }
            binding.orderStatus.background?.setTint(color)
        }

        private fun bindCountdown(order: Order) {
            timer?.cancel()
            if (order.status == "CLAIMED" && order.claimExpiresAt != null) {
                val remaining = order.claimExpiresAt - System.currentTimeMillis()
                if (remaining > 0) {
                    binding.orderCountdown.visibility = View.VISIBLE
                    timer = object : CountDownTimer(remaining, 1000) {
                        override fun onTick(millisUntilFinished: Long) {
                            val totalSeconds = millisUntilFinished / 1000
                            val minutes = totalSeconds / 60
                            val seconds = totalSeconds % 60
                            binding.orderCountdown.text = String.format("剩余 %02d:%02d", minutes, seconds)
                        }

                        override fun onFinish() {
                            binding.orderCountdown.text = "剩余 00:00"
                        }
                    }.start()
                } else {
                    binding.orderCountdown.visibility = View.VISIBLE
                    binding.orderCountdown.text = "剩余 00:00"
                }
            } else {
                binding.orderCountdown.visibility = View.GONE
            }
        }

        fun clearTimer() {
            timer?.cancel()
            timer = null
        }
    }
}
