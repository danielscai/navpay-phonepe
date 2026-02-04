package com.phonepe.checksumclient

import android.os.Bundle
import android.view.View
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.phonepe.checksumclient.databinding.FragmentOrdersBinding
import kotlinx.coroutines.launch

class OrdersFragment : Fragment(R.layout.fragment_orders) {
    private var _binding: FragmentOrdersBinding? = null
    private val binding get() = _binding!!
    private lateinit var adapter: OrdersAdapter
    private lateinit var authManager: AuthManager
    private lateinit var apiClient: ApiClient

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        _binding = FragmentOrdersBinding.bind(view)
        authManager = AuthManager(requireContext())
        apiClient = ApiClient(authManager)
        adapter = OrdersAdapter()
        binding.ordersList.layoutManager = LinearLayoutManager(requireContext())
        binding.ordersList.adapter = adapter

        binding.ordersRefresh.setOnClickListener { loadOrders() }
        loadOrders()
    }

    private fun loadOrders() {
        if (!authManager.isTokenValid()) {
            adapter.submit(emptyList())
            return
        }
        lifecycleScope.launch {
            try {
                val orders = apiClient.getOrders()
                adapter.submit(orders)
            } catch (e: Exception) {
                adapter.submit(emptyList())
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
