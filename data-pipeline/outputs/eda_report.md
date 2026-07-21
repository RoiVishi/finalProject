# EDA Report — Task Delay Dataset

- Total tasks: **126,706** across **59** projects (after dedup)
- Labeled tasks: **11,705** in **17** projects
- Late rate: **40.5%**
- Delay days: median 0, IQR [-11, 10], min -810, max 509
- Extreme delays (>365d abs): 26 tasks

## Labeled tasks per project

| project                                                  |    n |   late_rate |
|:---------------------------------------------------------|-----:|------------:|
| EBCF-4 070127 Forecast Original                          | 3272 |  0.469743   |
| rehab-2                                                  | 2037 |  0.616593   |
| CCA R03 dt 24Oct11SC                                     | 1591 |  0.542426   |
| jumaira                                                  | 1350 |  0          |
| 129 trial                                                |  769 |  0.525358   |
| hela-2l                                                  |  660 |  0.30303    |
| Enppi                                                    |  548 |  0.326642   |
| MERGE PROJECTS                                           |  548 |  0.326642   |
| PORTO MATROUH                                            |  422 |  0.049763   |
| Convention _ Exhibition Center Project Roads _ Utilities |  157 |  0.229299   |
| Detailed Program                                         |  115 |  0.00869565 |
| 130 TRIAL                                                |   85 |  0.541176   |
| update of jungle 20-07-2010                              |   73 |  0.150685   |
| cairo alex-road                                          |   46 |  0.0869565  |
| Update 01-09-2010                                        |   16 |  0.25       |
| trial for me                                             |   15 |  0          |
| Petrofac                                                 |    1 |  0          |

## Feature medians by class (late vs on-time)

|   is_late |   planned_duration_days |   total_float_hr |   n_pred |   n_succ |   upstream_cnt |   downstream_cnt |   rel_position |
|----------:|------------------------:|-----------------:|---------:|---------:|---------------:|-----------------:|---------------:|
|         0 |                       7 |              168 |        1 |        1 |             18 |              103 |       0.26354  |
|         1 |                      11 |              160 |        1 |        1 |             22 |              349 |       0.241744 |