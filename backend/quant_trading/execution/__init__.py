"""G5 paper-trading execution boundary.

Only deterministic simulation adapters are operational.  Nothing in this
package opens a broker connection or implements a real-money order path.
"""

from quant_trading.execution.adapter import BrokerAdapter, build_adapter, register_adapter
from quant_trading.execution import mock_broker as _mock_broker  # registers local adapters
from quant_trading.execution.orders import OrderStatus, apply_fill, transition_order
from quant_trading.execution.safety import KillSwitch, SafetyLimits

__all__ = [
    "BrokerAdapter",
    "KillSwitch",
    "OrderStatus",
    "SafetyLimits",
    "apply_fill",
    "build_adapter",
    "register_adapter",
    "transition_order",
]
