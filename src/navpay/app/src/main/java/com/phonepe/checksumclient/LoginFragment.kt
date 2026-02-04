package com.phonepe.checksumclient

import android.os.Bundle
import android.view.View
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.phonepe.checksumclient.databinding.FragmentLoginBinding
import kotlinx.coroutines.launch

class LoginFragment : Fragment(R.layout.fragment_login) {
    interface Callback {
        fun onLoginSuccess(profile: UserProfile)
    }

    private var _binding: FragmentLoginBinding? = null
    private val binding get() = _binding!!
    private lateinit var apiClient: ApiClient

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        super.onViewCreated(view, savedInstanceState)
        _binding = FragmentLoginBinding.bind(view)
        apiClient = ApiClient(AuthManager(requireContext()))

        binding.loginBtn.setOnClickListener {
            val username = binding.usernameInput.text?.toString()?.trim().orEmpty()
            val password = binding.passwordInput.text?.toString()?.trim().orEmpty()
            if (username.isEmpty() || password.isEmpty()) {
                binding.loginStatus.text = "Username and password required"
                return@setOnClickListener
            }
            binding.loginStatus.text = "Logging in..."
            binding.loginBtn.isEnabled = false
            lifecycleScope.launch {
                try {
                    val result = apiClient.login(username, password)
                    binding.loginStatus.text = "Login success"
                    (activity as? Callback)?.onLoginSuccess(result.user)
                } catch (e: Exception) {
                    binding.loginStatus.text = e.message ?: "Login failed"
                } finally {
                    binding.loginBtn.isEnabled = true
                }
            }
        }
    }

    override fun onDestroyView() {
        super.onDestroyView()
        _binding = null
    }
}
