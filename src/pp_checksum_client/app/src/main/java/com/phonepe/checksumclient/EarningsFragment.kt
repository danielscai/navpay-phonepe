package com.phonepe.checksumclient

import android.os.Bundle
import android.view.View
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.phonepe.checksumclient.databinding.FragmentEarningsBinding
import kotlinx.coroutines.launch
import android.widget.Toast

class EarningsFragment : Fragment(R.layout.fragment_earnings) {
    interface AuthHost {
        fun onAuthInvalid()
    }
    private var _binding: FragmentEarningsBinding? = null
    private val binding get() = _binding!!
    private lateinit var adapter: EarningsAdapter
    private lateinit var authManager: AuthManager
    private lateinit var apiClient: ApiClient

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        _binding = FragmentEarningsBinding.bind(view)
        authManager = AuthManager(requireContext())
        apiClient = ApiClient(authManager)
        adapter = EarningsAdapter()
        binding.earningsList.layoutManager = LinearLayoutManager(requireContext())
        binding.earningsList.adapter = adapter

        binding.earningsRefresh.setOnClickListener { loadEarnings() }
        loadEarnings()
    }

    private fun loadEarnings() {
        if (!authManager.isTokenValid()) {
            binding.earningsTotal.text = "Total: 0"
            adapter.submit(emptyList())
            return
        }
        lifecycleScope.launch {
            try {
                val result = apiClient.getEarnings()
                binding.earningsTotal.text = "Total: ${result.total}"
                adapter.submit(result.earnings)
            } catch (e: Exception) {
                if (e is AuthException) {
                    (activity as? AuthHost)?.onAuthInvalid()
                    return@launch
                }
                showError("服务不可用，请稍后重试")
            }
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
