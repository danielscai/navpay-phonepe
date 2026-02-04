package com.phonepe.checksumclient

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.phonepe.checksumclient.databinding.ItemEarningBinding

class EarningsAdapter : RecyclerView.Adapter<EarningsAdapter.ViewHolder>() {
    private val items = ArrayList<Earning>()

    fun submit(list: List<Earning>) {
        items.clear()
        items.addAll(list)
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        val binding = ItemEarningBinding.inflate(LayoutInflater.from(parent.context), parent, false)
        return ViewHolder(binding)
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        holder.bind(items[position])
    }

    override fun getItemCount(): Int = items.size

    class ViewHolder(private val binding: ItemEarningBinding) : RecyclerView.ViewHolder(binding.root) {
        fun bind(item: Earning) {
            binding.earningId.text = item.id
            binding.earningNote.text = item.note
            binding.earningAmount.text = "${item.currency} ${item.amount}"
            binding.earningTime.text = item.createdAt
        }
    }
}
