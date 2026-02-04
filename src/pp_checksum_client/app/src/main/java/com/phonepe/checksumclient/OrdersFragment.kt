package com.phonepe.checksumclient

import android.os.Bundle
import android.view.View
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.phonepe.checksumclient.databinding.FragmentOrdersBinding
import kotlinx.coroutines.launch
import android.widget.Toast

class OrdersFragment : Fragment(R.layout.fragment_orders) {
    interface AuthHost {
        fun onAuthInvalid()
    }
    private var _binding: FragmentOrdersBinding? = null
    private val binding get() = _binding!!
    private lateinit var myAdapter: OrdersAdapter
    private lateinit var openAdapter: OpenOrdersAdapter
    private lateinit var authManager: AuthManager
    private lateinit var apiClient: ApiClient

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        _binding = FragmentOrdersBinding.bind(view)
        authManager = AuthManager(requireContext())
        apiClient = ApiClient(authManager)
        myAdapter = OrdersAdapter()
        openAdapter = OpenOrdersAdapter { order -> claimOrder(order) }

        binding.ordersList.layoutManager = LinearLayoutManager(requireContext())
        binding.ordersList.adapter = myAdapter
        binding.openOrdersList.layoutManager = LinearLayoutManager(requireContext())
        binding.openOrdersList.adapter = openAdapter

        binding.ordersRefresh.setOnClickListener { refreshAll() }
        refreshAll()
    }

    private fun refreshAll() {
        if (!authManager.isTokenValid()) {
            myAdapter.submit(emptyList())
            openAdapter.submit(emptyList())
            return
        }
        binding.ordersRefresh.isEnabled = false
        lifecycleScope.launch {
            try {
                val myOrders = apiClient.getMyOrders()
                myAdapter.submit(myOrders)
            } catch (e: Exception) {
                if (e is AuthException) {
                    (activity as? AuthHost)?.onAuthInvalid()
                    return@launch
                }
                showError("服务不可用，请稍后重试")
                return@launch
            }
            try {
                val openOrders = apiClient.getOpenOrders()
                openAdapter.submit(openOrders)
            } catch (e: Exception) {
                if (e is AuthException) {
                    (activity as? AuthHost)?.onAuthInvalid()
                    return@launch
                }
                showError("服务不可用，请稍后重试")
                return@launch
            } finally {
                if (isAdded) {
                    binding.ordersRefresh.isEnabled = true
                }
            }
        }
    }

    private fun claimOrder(order: Order) {
        if (!authManager.isTokenValid()) return
        lifecycleScope.launch {
            try {
                apiClient.claimOrder(order.id)
            } catch (e: Exception) {
                if (e is AuthException) {
                    (activity as? AuthHost)?.onAuthInvalid()
                    return@launch
                }
                showError("抢单失败，请稍后重试")
                return@launch
            }
            refreshAll()
        }
    }

    private fun showError(message: String) {
        if (!isAdded) return
        Toast.makeText(requireContext(), message, Toast.LENGTH_SHORT).show()
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
