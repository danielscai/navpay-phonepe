package com.phonepe.checksumclient

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import com.phonepe.checksumclient.databinding.ActivityMainBinding

class MainActivity : AppCompatActivity(), LoginFragment.Callback, ProfileFragment.Callback {

    private lateinit var binding: ActivityMainBinding
    private lateinit var authManager: AuthManager

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)
        authManager = AuthManager(this)

        binding.bottomNav.setOnItemSelectedListener { item ->
            when (item.itemId) {
                R.id.nav_orders -> {
                    showFragment(OrdersFragment())
                    true
                }
                R.id.nav_earnings -> {
                    showFragment(EarningsFragment())
                    true
                }
                R.id.nav_profile -> {
                    showFragment(ProfileFragment())
                    true
                }
                R.id.nav_tools -> {
                    showFragment(ToolsFragment())
                    true
                }
                else -> false
            }
        }

        if (authManager.isTokenValid()) {
            binding.bottomNav.visibility = android.view.View.VISIBLE
            binding.bottomNav.selectedItemId = R.id.nav_orders
        } else {
            binding.bottomNav.visibility = android.view.View.GONE
            showFragment(LoginFragment())
        }
    }

    private fun showFragment(fragment: androidx.fragment.app.Fragment) {
        supportFragmentManager.beginTransaction()
            .replace(R.id.fragment_container, fragment)
            .commit()
    }

    override fun onLoginSuccess(profile: UserProfile) {
        binding.bottomNav.visibility = android.view.View.VISIBLE
        binding.bottomNav.selectedItemId = R.id.nav_orders
    }

    override fun onLogout() {
        binding.bottomNav.visibility = android.view.View.GONE
        showFragment(LoginFragment())
    }
}
