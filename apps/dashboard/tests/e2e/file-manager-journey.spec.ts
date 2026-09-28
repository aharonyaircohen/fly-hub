import { expect, test, type Page, type Route } from "@playwright/test";
import { mockDashboardShellRequests } from "./support/dashboard-shell-mocks";

const OWNER = "file-manager-e2e";
const REPO = "workspace";
const REPO_ROUTE = `/repo/${OWNER}/${REPO}/files`;
const MINIMAL_DOCX_BASE64 =
  "UEsDBAoAAAAIAINs+VzMVIwQ4AAAAJwBAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbH2Qy07DMBBFf8XyFsUTukAIJekCyhJYlA+w7Eli4Zc8bil/z6QtXaDC0r6PM7rd+hC82GMhl2Ivb1UrBUaTrItTL9+3z829XA/d9isjCbZG6uVca34AIDNj0KRSxsjKmErQlZ9lgqzNh54QVm17BybFirE2demQQ/eEo975KjYH/j5hC3qS4vFkXFi91Dl7Z3RlHfbR/qI0Z4Li5NFDs8t0wwYJVwmL8jfgnHvlHYqzKN50qS86sAs+U7Fgk9kFTqr/a67cmcbRGbzkl7ZckkEiHjh4dVGCdvHnfjjOPXwDUEsDBAoAAAAAAINs+VwAAAAAAAAAAAAAAAAGAAAAX3JlbHMvUEsDBAoAAAAIAINs+Vw2V97cogAAABgBAAALAAAAX3JlbHMvLnJlbHONzzsOwjAMBuCrRN6pCwNCqGkXhNQVlQNEiZtGNA8l4XV7MjBQxMBo+/dnuekedmY3isl4x2Fd1cDISa+M0xzOw3G1g65tTjSLXBJpMiGxsuIShynnsEdMciIrUuUDuTIZfbQilzJqDEJehCbc1PUW46cBS5P1ikPs1RrY8Az0j+3H0Ug6eHm15PKPE1+JIouoKXO4+6hQvdtVYQHbBhcvti9QSwMECgAAAAAAg2z5XAAAAAAAAAAAAAAAAAUAAAB3b3JkL1BLAwQKAAAACACDbPlcxAoXTawAAADoAAAAEQAAAHdvcmQvZG9jdW1lbnQueG1sRY4xbsMwDEWvImiv5WYIAsN2tqzpkB5AkWhbqEUKpBo3t4/kDF0ewf+JB/bnv7iqB7AEwkF/Nq1WgI58wHnQ37fLx0kryRa9XQlh0E8QfR77rfPkfiNgVkWA0m2DXnJOnTHiFohWGkqApZuIo81l5dlsxD4xORAp/riaQ9seTbQBdVXeyT/rTBVckcfrNAUHKjE8AmyqGH6kN7Wp5J37vYDLX2z24C0y/0+OL1BLAQIUAAoAAAAIAINs+VzMVIwQ4AAAAJwBAAATAAAAAAAAAAAAAAAAAAAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQACgAAAAAAg2z5XAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAQAAAAEQEAAF9yZWxzL1BLAQIUAAoAAAAIAINs+Vw2V97cogAAABgBAAALAAAAAAAAAAAAAAAAADUBAABfcmVscy8ucmVsc1BLAQIUAAoAAAAAAINs+VwAAAAAAAAAAAAAAAAFAAAAAAAAAAAAEAAAAAACAAB3b3JkL1BLAQIUAAoAAAAIAINs+VzEChdNrAAAAOgAAAARAAAAAAAAAAAAAAAAACMCAAB3b3JkL2RvY3VtZW50LnhtbFBLBQYAAAAABQAFACABAAD+AgAAAAA=";
const MINIMAL_XLSX_BASE64 =
  "UEsDBAoAAAAIAPVz+Vy9XP2Q8gAAABwCAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbK2RvU7DMBDHX8XyWsVOOyCEknQodASG8gCHc0ms+Es+t4S3x0kLAyqwMJ3s/8fvZFfbyRp2wkjau5qvRckZOuVb7fqavxz2xS3fNtXhPSCxbHVU8yGlcCclqQEtkPABXVY6Hy2kfIy9DKBG6FFuyvJGKu8SulSkuYM31T12cDSJPUz5+oyNaIiz3dk4s2oOIRitIGVdnlz7jVJcCCInFw8NOtAqG7i8SpiVnwGX3FN+h6hbZM8Q0yPY7JKTkW8+jq/ej+L3kitb+q7TCluvjjZHBIWI0NKAmKwRyxQWtFv9zV/MJJex/udFvvo/95DLdzcfUEsDBAoAAAAAAPVz+VwAAAAAAAAAAAAAAAAGAAAAX3JlbHMvUEsDBAoAAAAIAPVz+VwcSfe+pAAAABYBAAALAAAAX3JlbHMvLnJlbHONz8EOwiAMBuBXIb07pgdjzNguxmRXMx8AWcfIBiWAOt9ejs548Nj0/7+mVbPYmT0wRENOwLYogaFT1BunBVy78+YATV1dcJYpJ+JofGS54qKAMSV/5DyqEa2MBXl0eTNQsDLlMWjupZqkRr4ryz0PnwasTdb2AkLbb4F1L4//2DQMRuGJ1N2iSz9OfCWyLIPGJGCZ+ZPCdCOaiowCryu+erB+A1BLAwQKAAAAAAD1c/lcAAAAAAAAAAAAAAAAAwAAAHhsL1BLAwQKAAAACAD1c/lcHTwHyK4AAAAKAQAADwAAAHhsL3dvcmtib29rLnhtbI2Pyw6CQAxFf2XSvQ64MIbw2BgT1+oHjFBgAjMl7fj4fEeQvavevk578+rtRvVEFku+gHSbgEJfU2N9V8DtetocoCrzF/FwJxpUnPZSQB/ClGktdY/OyJYm9LHTEjsTYsqdlonRNNIjBjfqXZLstTPWw0LI+B8Gta2t8Uj1w6EPC4RxNCH+Kr2dBMp8viC/qLxxWMDlq1NQc+3cRFugOLNR8LlJQZe5Xtf06qz8AFBLAwQKAAAAAAD1c/lcAAAAAAAAAAAAAAAACQAAAHhsL19yZWxzL1BLAwQKAAAACAD1c/lc8KZigaYAAAAXAQAAGgAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzjc9LCsIwEADQq4TZ22ldiEjTbkToVuoBQjpNSpsPSfzd3uBCLLhwNczvDVO3D7OwG4U4OcuhKkpgZKUbJqs4XPrTZg9tU59pESlPRD35yPKKjRx0Sv6AGKUmI2LhPNncGV0wIuU0KPRCzkIRbstyh+HbgLXJuoFD6IYKWP/09I/txnGSdHTyasimHyfw7sIcNVHKqAiKEodPKeI7VEVWAZsaVx82L1BLAwQKAAAAAAD1c/lcAAAAAAAAAAAAAAAADgAAAHhsL3dvcmtzaGVldHMvUEsDBAoAAAAIAPVz+VzxGlkWqQAAAOwAAAAYAAAAeGwvd29ya3NoZWV0cy9zaGVldDEueG1sTU5BDsIwDPtK1TvL4IAQajshIT4weEDVha1ibac22ng+2Q7AIZHjOLFV8w6jmDEXn6KW+6qWAqNLnY+9lo/7bXeSjVFLyq8yIJJgeSxaDkTTGaC4AYMtVZow8uaZcrDEY+6hTBlttx2FEQ51fYRgfZRGbdzVkjUqp0VktmXWreCyl4K09HH0EVvKzPtiFJn2900wnD0uYgulgIyCVQSOix9y/3OAb3TzAVBLAQIUAAoAAAAIAPVz+Vy9XP2Q8gAAABwCAAATAAAAAAAAAAAAAAAAAAAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQACgAAAAAA9XP5XAAAAAAAAAAAAAAAAAYAAAAAAAAAAAAQAAAAIwEAAF9yZWxzL1BLAQIUAAoAAAAIAPVz+VwcSfe+pAAAABYBAAALAAAAAAAAAAAAAAAAAEcBAABfcmVscy8ucmVsc1BLAQIUAAoAAAAAAPVz+VwAAAAAAAAAAAAAAAADAAAAAAAAAAAAEAAAABQCAAB4bC9QSwECFAAKAAAACAD1c/lcHTwHyK4AAAAKAQAADwAAAAAAAAAAAAAAAAA1AgAAeGwvd29ya2Jvb2sueG1sUEsBAhQACgAAAAAA9XP5XAAAAAAAAAAAAAAAAAkAAAAAAAAAAAAQAAAAEAMAAHhsL19yZWxzL1BLAQIUAAoAAAAIAPVz+VzwpmKBpgAAABcBAAAaAAAAAAAAAAAAAAAAADcDAAB4bC9fcmVscy93b3JrYm9vay54bWwucmVsc1BLAQIUAAoAAAAAAPVz+VwAAAAAAAAAAAAAAAAOAAAAAAAAAAAAEAAAABUEAAB4bC93b3Jrc2hlZXRzL1BLAQIUAAoAAAAIAPVz+VzxGlkWqQAAAOwAAAAYAAAAAAAAAAAAAAAAAEEEAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxQSwUGAAAAAAkACQAdAgAAIAUAAAAA";
const MINIMAL_ZIP_BASE64 =
  "UEsDBAoAAAAIAPh1+VwX0GU1FAAAABIAAAAJAAAAaGVsbG8udHh0i/IMUCgoSi3LTC1XKM8vyi7mAgBQSwECFAAKAAAACAD4dflcF9BlNRQAAAASAAAACQAAAAAAAAAAAAAAAAAAAAAAaGVsbG8udHh0UEsFBgAAAAABAAEANwAAADsAAAAAAA==";
const MINIMAL_PPTX_BASE64 =
  "UEsDBAoAAAAIAPmZB12fTLSnIgEAAM4DAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbLWTyW7CMBCGX8XytSKGHqqqInDocup2oA8wciZg1Zs8A4K375BQiVa0ILVcEo3nXz5F8Xi6Dl6tsJBLsdajaqgVRpsaF+e1fps9DK61IobYgE8Ra71B0tPJeLbJSEq8kWq9YM43xpBdYACqUsYomzaVACxjmZsM9h3maC6HwytjU2SMPOBthp6M77CFpWd1v5bjnqOgJ61ue+G2q9aQs3cWWPZmFZtvLYNdQyXOTkMLl+lCBNocbNhufi7Y+V7kwxTXoHqFws8QRGVyZpMLkvg6bfV70gHU1LbOYpPsMoil2g8L/stYBXDx4ggMeTmk/jX6b5ou9SSCR9ikJdP+cB6aPvskpicgll97fzgPU599jInlfmD//DtGF/PZaLr7OPkAUEsDBAoAAAAAAPmZB10AAAAAAAAAAAAAAAAGAAAAX3JlbHMvUEsDBAoAAAAIAPmZB10byrjurgAAACwBAAALAAAAX3JlbHMvLnJlbHONz80KwjAMB/BXKbm7Tg8ism4XEXaV+QClzbri+kFTxb29xZMTDx6T/PMLabqnm9kDE9ngBWyrGhh6FbT1RsB1OG8OwChLr+UcPApYkKBrmwvOMpcVmmwkVgxPAqac45FzUhM6SVWI6MtkDMnJXMpkeJTqJg3yXV3vefo0YG2yXgtIvd4CG5aI/9hhHK3CU1B3hz7/OPGVKLJMBrOAGDOPCak03+mqyMDbhq++bF9QSwMECgAAAAAA+ZkHXQAAAAAAAAAAAAAAAAQAAABwcHQvUEsDBAoAAAAIAPmZB13jTSim/gAAAP8BAAAUAAAAcHB0L3ByZXNlbnRhdGlvbi54bWyNUUtOwzAQvYrlPXWSpiGN4nSDkJBgBRzAsieNpfgjj4GW0+O0qUiRkLrzzPvMG0+7O5iRfEJA7Syn+SqjBKx0Sts9p+9vj3c1JRiFVWJ0Fjg9AtJd1/rGB0CwUcQkJMnEYiM4HWL0DWMoBzACV86DTVjvghExlWHPVBBfydyMrMiyihmhLZ314Ra963st4cHJD5PGn00CjKccOGiPFzd/i9tyi6tI04o4qheBEcKTesb4p0O04rTIy/uyXldl+qXQTJ2E5JR1LftHfv0+m2yqhbr4VS+5r99EHtKBinybQqYrySOnVb2pp4JNJOsi4Ey7ACfWNi/LmcWu79b9AFBLAwQKAAAAAAD5mQddAAAAAAAAAAAAAAAACgAAAHBwdC9fcmVscy9QSwMECgAAAAgA+ZkHXSMUH0q9AAAAtwEAAB8AAABwcHQvX3JlbHMvcHJlc2VudGF0aW9uLnhtbC5yZWxzrZDBCsIwDIZfpeTuunkQEasXETx4kfkAoc224taWpop7e3sQceLBg8f8Sb58ZL29D724UWTrnYKqKEGQ095Y1yo41/vZEgQndAZ770jBSAzbzfpEPaa8wp0NLDLDsYIupbCSknVHA3LhA7ncaXwcMOUytjKgvmBLcl6WCxnfGTBlioNREA+mAlGPgX5h+6axmnZeXwdy6csJyb01dEROFDMWY0tJwVs4maiKzAf5XWv+d60PoWf6kpCTh28eUEsDBAoAAAAAAPmZB10AAAAAAAAAAAAAAAALAAAAcHB0L3NsaWRlcy9QSwMECgAAAAgA+ZkHXdPND3q1AQAAvwMAABUAAABwcHQvc2xpZGVzL3NsaWRlMS54bWyNU8tu2zAQ/BWC95iSHbiJEDlA0jaXNhFqB+iVpdaWUL6wZGU5X1+Skuo49cEXcrmcHc4slnf3vZKkA3St0SXNZxkloIWpW70r6evm69UNJc5zXXNpNJT0AI7er+5s4WRNQq12BS9p470tGHOiAcXdzFjQ4W5rUHEfjrhjNfJ94FSSzbNsyRRvNR3r8ZJ6s922Aj4b8UeB9gMJguQ+6HZNa93EZi9hswgu0KTqE0nRmVjLOjm0GwSIke6e0K5then6uauQtHXoFiWaq9AUysaLEcaGohSwD+W7KeRFv0UV9+CN9CUNrT/ElcUc9J6IISmOWdG8nMGK5ssZNJseYO8eja4Gcf/bmU92Nq2XQPJ/rs5aOvKdNXObX19ng8oxPLGVZ4vlYp6NevPFp3yZnarmhUXnn8AoEoOSIghPY55335wfoBMkaXKjIt8/mPoQkb/CnhTzQjq/9gcJ6WDjklRj8C55nHXQV6/rMOtvJU3CEtCvqmrzMwiAroU92Rv87eK7Pr2eGEDXFUf+4wPRqC8JmwSxofvsOFrsOG1C4nduX7pEGsbWAz6mlA3fZmj6OwhLH3D1F1BLAwQKAAAAAAD5mQddAAAAAAAAAAAAAAAAEQAAAHBwdC9zbGlkZXMvX3JlbHMvUEsDBAoAAAAIAPmZB13dEU1KsgAAADUBAAAgAAAAcHB0L3NsaWRlcy9fcmVscy9zbGlkZTEueG1sLnJlbHONz70KwjAQB/BXCbebtA4i0tRFhIKT6AMcybUNtknIRbFvb0YLDo739ftzzfE9T+JFiV3wGmpZgSBvgnV+0HC/nTd7EJzRW5yCJw0LMRzb5koT5nLCo4ssiuFZw5hzPCjFZqQZWYZIvkz6kGbMpUyDimgeOJDaVtVOpW8D1qborIbU2RrEbYn0jx363hk6BfOcyecfEYonZ+mCS3jmwmIaKGuQ8ru/WqpliQDVNmr1bvsBUEsDBAoAAAAAAPmZB10AAAAAAAAAAAAAAAARAAAAcHB0L3NsaWRlTGF5b3V0cy9QSwMECgAAAAgA+ZkHXQ+6hTsoAQAAYQIAACEAAABwcHQvc2xpZGVMYXlvdXRzL3NsaWRlTGF5b3V0MS54bWyNUstOwzAQ/BXLd7qFA0JR00o8L0ArtXyAcTYP4ZfWbkj+HudFA+qhF3s9nhnv2F5tGq1YjeQra1J+vVhyhkbarDJFyj8Oz1d3nPkgTCaUNZjyFj3frFcu8Sp7Fa09BhYdjE9EyssQXALgZYla+IV1aOJebkmLEJdUQEbiOzprBTfL5S1oURk+6ukSvc3zSuKjlUeNJgwmhEqE2L0vK+cnN3eJmyP00aZX/20ptC5m/VTCfPEurNyrjBmhI3j/C3p3IMSuMvULub3bUc99r3fEqizeJh81HMaNkQaDqC/gn7yYSpE0OelujqlZk/L4NG03QodhE5gcQHlCZbk9w5Xl0xk2TAfA7FA4xYIhdt+5ojfhtnXfVbzMgPTQQy4+5pBhRoHZ51j/AFBLAwQKAAAAAAD5mQddAAAAAAAAAAAAAAAAFwAAAHBwdC9zbGlkZUxheW91dHMvX3JlbHMvUEsDBAoAAAAIAPmZB11rnPwPsQAAADUBAAAsAAAAcHB0L3NsaWRlTGF5b3V0cy9fcmVscy9zbGlkZUxheW91dDEueG1sLnJlbHONz70KwjAQB/BXCbebtA4i0tRFBAcX0Qc4kmsbbJOQi2Lf3owtODje1+/PNcfPNIo3JXbBa6hlBYK8Cdb5XsPjft7sQXBGb3EMnjTMxHBsmxuNmMsJDy6yKIZnDUPO8aAUm4EmZBki+TLpQpowlzL1KqJ5Yk9qW1U7lZYGrE1xsRrSxdYg7nOkf+zQdc7QKZjXRD7/iFA8OktX5EypsJh6yhqkXPZXS7UsEaDaRq3ebb9QSwMECgAAAAAA+ZkHXQAAAAAAAAAAAAAAABEAAABwcHQvc2xpZGVNYXN0ZXJzL1BLAwQKAAAACAD5mQddAWvYv4oBAABlAwAAIQAAAHBwdC9zbGlkZU1hc3RlcnMvc2xpZGVNYXN0ZXIxLnhtbI2T3U7jMBCFX8Wa+8VtgGoVEbgBdpFgF6nwAK49+RGObY1NN3n7tZNYLYULbpIzn31mPOPk6mboNdsj+c6aCtZnK2BopFWdaSp4fbn/8ROYD8Iooa3BCkb0cHN95Uqv1ZPwAYnFDMaXooI2BFdy7mWLvfBn1qGJa7WlXoQYUsMViX8xc695sVpteC86A4ufvuO3dd1JvLXyvUcT5iSEWoR4et92zuds7jvZHKGPaSb3hyOl/uRWq6lP90KISZn9L3Jb90zT8p/9M7FOxZkBM6KPowG+LCzb+GyaBD+xN1mKcqipT+/YGxsqiBcwpidPDIfA5Azlgcr27xd7ZXv3xW6eC/CjovzQFj90KjU9CceElHEo6woWAQspMikyOc/kPJOLTC4yuczkMpNNJhtguybW0anGrimSirlrq3/rzrxVkBWwdgbtHIUhutTbOqkiqWIeffwkH8Vo38ODevThhOS7ojIJelBrmO/lsysM2zBq9JPugsYpnErsrBoPkQ0tUg75sZEf/SDX/wFQSwMECgAAAAAA+ZkHXQAAAAAAAAAAAAAAABcAAABwcHQvc2xpZGVNYXN0ZXJzL19yZWxzL1BLAwQKAAAACAD5mQddql/cLMgAAAC8AQAALAAAAHBwdC9zbGlkZU1hc3RlcnMvX3JlbHMvc2xpZGVNYXN0ZXIxLnhtbC5yZWxzrZBNasMwEIWvImYfyc6ilBAlm1IIdFXSAwzS2BaxJaGZlPr2FQmEGLLIIpuB+Xnfe8x2/zeN6pcKhxQttLoBRdElH2Jv4ef4uXoHxYLR45giWZiJYb/bftOIUiU8hMyqMiJbGETyxhh2A03IOmWKddOlMqHUtvQmozthT2bdNG+m3DNgyVQHb6EcfAvqOGd6hp26Ljj6SO48UZQHFobH4OkL53SWisXSk1jQ+n6+OGp1tQDzONn6lcmkammR6TK51lsMs/j67h9QSwMECgAAAAAA+ZkHXQAAAAAAAAAAAAAAAAoAAABwcHQvdGhlbWUvUEsDBAoAAAAIAPmZB13QyHuWnAEAADQEAAAUAAAAcHB0L3RoZW1lL3RoZW1lMS54bWyFk91uozAQhV/F8n1rSAklUUgVKGgvKvWi3QdwjUm88Q/CVlvevo6TAF5vtL4AZvydM4PG3jx9Cw4+aa+ZkjmM7yMIqCSqYXKfw9/v9V0GgTZYNpgrSXM4UA2fthu8NgcqKLBqqdc4hwdjujVCmtg01veqo9LutaoX2Niw36Omx1/WVXC0iKIUCcwkBBILa/ratoxQONpW3D6k0acE4f0bcbUCtjnGp5cedMl78Il5Dm2FRn29028DAcfa2I0cRm5BtN2gUcTNDe1MV7t10V0EzXHhdP3+YxTGdbJ6fB79F2f/kKuqqqzi0c8BmBD7p3HAJnUWF1fPGXT+DL3LaBklPj/zfwj4VVEUy5XHP0x8EvBZlCa7hccnE78M+y92ZZl6/HLi04CvH1dp4vMOOnAmjwF9muc4mRFpFf/1TzyzeHY9ABOFZqfrrJfm1lkT+I/qawu44WLDJDBDR1tMLLfrjNLgmemO4+FSxhMIJv+jvqomEM0bcu2Jm921jPM3M3D6og1yNaQX0ralxHipj33ti9Csgov+uorXzPYHUEsBAhQACgAAAAgA+ZkHXZ9MtKciAQAAzgMAABMAAAAAAAAAAAAAAAAAAAAAAFtDb250ZW50X1R5cGVzXS54bWxQSwECFAAKAAAAAAD5mQddAAAAAAAAAAAAAAAABgAAAAAAAAAAABAAAABTAQAAX3JlbHMvUEsBAhQACgAAAAgA+ZkHXRvKuO6uAAAALAEAAAsAAAAAAAAAAAAAAAAAdwEAAF9yZWxzLy5yZWxzUEsBAhQACgAAAAAA+ZkHXQAAAAAAAAAAAAAAAAQAAAAAAAAAAAAQAAAATgIAAHBwdC9QSwECFAAKAAAACAD5mQdd400opv4AAAD/AQAAFAAAAAAAAAAAAAAAAABwAgAAcHB0L3ByZXNlbnRhdGlvbi54bWxQSwECFAAKAAAAAAD5mQddAAAAAAAAAAAAAAAACgAAAAAAAAAAABAAAACgAwAAcHB0L19yZWxzL1BLAQIUAAoAAAAIAPmZB10jFB9KvQAAALcBAAAfAAAAAAAAAAAAAAAAAMgDAABwcHQvX3JlbHMvcHJlc2VudGF0aW9uLnhtbC5yZWxzUEsBAhQACgAAAAAA+ZkHXQAAAAAAAAAAAAAAAAsAAAAAAAAAAAAQAAAAwgQAAHBwdC9zbGlkZXMvUEsBAhQACgAAAAgA+ZkHXdPND3q1AQAAvwMAABUAAAAAAAAAAAAAAAAA6wQAAHBwdC9zbGlkZXMvc2xpZGUxLnhtbFBLAQIUAAoAAAAAAPmZB10AAAAAAAAAAAAAAAARAAAAAAAAAAAAEAAAANMGAABwcHQvc2xpZGVzL19yZWxzL1BLAQIUAAoAAAAIAPmZB13dEU1KsgAAADUBAAAgAAAAAAAAAAAAAAAAAAIHAABwcHQvc2xpZGVzL19yZWxzL3NsaWRlMS54bWwucmVsc1BLAQIUAAoAAAAAAPmZB10AAAAAAAAAAAAAAAARAAAAAAAAAAAAEAAAAPIHAABwcHQvc2xpZGVMYXlvdXRzL1BLAQIUAAoAAAAIAPmZB10PuoU7KAEAAGECAAAhAAAAAAAAAAAAAAAAACEIAABwcHQvc2xpZGVMYXlvdXRzL3NsaWRlTGF5b3V0MS54bWxQSwECFAAKAAAAAAD5mQddAAAAAAAAAAAAAAAAFwAAAAAAAAAAABAAAACICQAAcHB0L3NsaWRlTGF5b3V0cy9fcmVscy9QSwECFAAKAAAACAD5mQdda5z8D7EAAAA1AQAALAAAAAAAAAAAAAAAAAC9CQAAcHB0L3NsaWRlTGF5b3V0cy9fcmVscy9zbGlkZUxheW91dDEueG1sLnJlbHNQSwECFAAKAAAAAAD5mQddAAAAAAAAAAAAAAAAEQAAAAAAAAAAABAAAAC4CgAAcHB0L3NsaWRlTWFzdGVycy9QSwECFAAKAAAACAD5mQddAWvYv4oBAABlAwAAIQAAAAAAAAAAAAAAAADnCgAAcHB0L3NsaWRlTWFzdGVycy9zbGlkZU1hc3RlcjEueG1sUEsBAhQACgAAAAAA+ZkHXQAAAAAAAAAAAAAAABcAAAAAAAAAAAAQAAAAsAwAAHBwdC9zbGlkZU1hc3RlcnMvX3JlbHMvUEsBAhQACgAAAAgA+ZkHXapf3CzIAAAAvAEAACwAAAAAAAAAAAAAAAAA5QwAAHBwdC9zbGlkZU1hc3RlcnMvX3JlbHMvc2xpZGVNYXN0ZXIxLnhtbC5yZWxzUEsBAhQACgAAAAAA+ZkHXQAAAAAAAAAAAAAAAAoAAAAAAAAAAAAQAAAA9w0AAHBwdC90aGVtZS9QSwECFAAKAAAACAD5mQdd0Mh7lpwBAAA0BAAAFAAAAAAAAAAAAAAAAAAfDgAAcHB0L3RoZW1lL3RoZW1lMS54bWxQSwUGAAAAABUAFQCEBQAA7Q8AAAAA";
interface MockFile {
  content: string;
  base64Content?: string;
  omitContentsPayload?: boolean;
  sha: string;
}

interface GitTreeEntry {
  path: string;
  sha: string | null;
}

function json(route: Route, body: unknown, status = 200) {
  return route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });
}

async function installFileManagerHarness(
  page: Page,
  options: {
    codeFile?: boolean;
    emptyRepository?: boolean;
    failedDirectory?: string;
    fileReadDelayMs?: number;
    fileWriteDelayMs?: number;
    treeMutationVisibilityDelayMs?: number;
    htmlPreview?: boolean;
    largeImage?: boolean;
    officePreview?: boolean;
    presentationPreview?: boolean;
    spreadsheetPreview?: boolean;
    textSpreadsheetPreview?: boolean;
    zipPreview?: boolean;
  } = {},
) {
  const files = new Map<string, MockFile>(
    options.emptyRepository
      ? []
      : [
          ["README.md", { content: "# Workspace\n", sha: "readme-sha" }],
          ["notes.md", { content: "Committed notes\n", sha: "notes-sha" }],
          ["docs/guide.md", { content: "# Guide\n", sha: "guide-sha" }],
        ],
  );
  if (options.codeFile) {
    files.set("example.ts", {
      content: "export const ready = true;\n",
      sha: "example-ts-sha",
    });
  }
  if (options.largeImage) {
    files.set("large-image.png", {
      content: "",
      base64Content: "iVBORw0KGgo=",
      omitContentsPayload: true,
      sha: "large-image-sha",
    });
  }
  if (options.htmlPreview) {
    files.set("preview.html", {
      content:
        '<!doctype html><html><head><script src="https://preview.invalid/tailwind.js"></script><script src="https://preview.invalid/lucide.js"></script><style>.tab-content{display:none}.tab-content.active{display:block}</style></head><body><main><h1 class="text-blue-600">HTML preview works</h1><i data-lucide="file"></i><button onclick="document.querySelectorAll(\'.tab-content\').forEach((item)=>item.classList.remove(\'active\'));document.getElementById(\'details\').classList.add(\'active\')">Details</button><section id="summary" class="tab-content active">Summary content</section><section id="details" class="tab-content">Interactive details</section><script>let parentAccess = "allowed";try{void parent.document.title}catch{parentAccess = "blocked"}parent.postMessage({type:"html-preview-parent-access",value:parentAccess},"*")</script></main></body></html>',
      sha: "html-preview-sha",
    });
    files.set("lesson page.html", {
      content:
        '<!doctype html><html lang="he" dir="rtl"><body><main><h1>Encoded lesson preview works</h1></main><script>document.body.dataset.scriptExecuted = "true"</script></body></html>',
      sha: "encoded-html-preview-sha",
    });
  }
  if (options.officePreview) {
    files.set("report.docx", {
      content: "",
      base64Content: MINIMAL_DOCX_BASE64,
      sha: "report-docx-sha",
    });
  }
  if (options.spreadsheetPreview) {
    files.set("report.xlsx", {
      content: "",
      base64Content: MINIMAL_XLSX_BASE64,
      sha: "report-xlsx-sha",
    });
  }
  if (options.textSpreadsheetPreview) {
    files.set("report.csv", {
      content: "Status,Message\nReady,Office CSV preview works\n",
      sha: "report-csv-sha",
    });
  }
  if (options.presentationPreview) {
    files.set("slides.pptx", {
      content: "",
      base64Content: MINIMAL_PPTX_BASE64,
      sha: "slides-pptx-sha",
    });
  }
  if (options.zipPreview) {
    files.set("bundle.zip", {
      content: "",
      base64Content: MINIMAL_ZIP_BASE64,
      sha: "bundle-zip-sha",
    });
  }
  const blobs = new Map<string, string>();
  const unhandledGitHubRequests: string[] = [];
  let pendingTree: GitTreeEntry[] = [];
  let contentsSnapshotBeforeTreeMutation: Map<string, MockFile> | null = null;
  let treeMutationVisibleAt = 0;
  let rootDirectoryReads = 0;
  let sequence = 1;

  await page.addInitScript(
    ({ owner, repo }) => {
      if (window !== window.top) return;
      const nativeFetch = window.fetch.bind(window);
      window.fetch = (...args) => nativeFetch(...args);
      localStorage.setItem(
        "kody_auth",
        JSON.stringify({
          repoUrl: `https://github.com/${owner}/${repo}`,
          owner,
          repo,
          token: "e2e-token",
          user: {
            login: "file-manager-e2e",
            avatar_url: "",
            id: 1,
          },
          loggedInAt: Date.now(),
          repos: [
            {
              repoUrl: `https://github.com/${owner}/${repo}`,
              owner,
              repo,
              token: "e2e-token",
              addedAt: Date.now(),
              isLogin: true,
              user: {
                login: "file-manager-e2e",
                avatar_url: "",
                id: 1,
              },
            },
          ],
          currentRepoIndex: 0,
        }),
      );
    },
    { owner: OWNER, repo: REPO },
  );

  await mockDashboardShellRequests(page);

  await page.route("**/api/kody/auth/me", (route) =>
    json(route, {
      authenticated: true,
      user: {
        login: "file-manager-e2e",
        avatar_url: "",
        githubId: 1,
      },
      owner: OWNER,
      repo: REPO,
    }),
  );
  await page.route("**/api/kody/cms", (route) =>
    json(route, { cms: { configured: false, collections: [] } }),
  );
  await page.route("**/api/kody/navigation-favorites", (route) =>
    json(route, { favoriteHrefs: [] }),
  );
  await page.route("**/api/kody/agents", (route) => json(route, { agent: [] }));
  await page.route("**/api/kody/models*", (route) =>
    json(route, { models: [] }),
  );
  await page.route("**/api/kody/brain/models", (route) =>
    json(route, { models: [] }),
  );
  await page.route("**/api/kody/commands", (route) =>
    json(route, { commands: [] }),
  );
  await page.route("**/api/kody/chat/conversations**", (route) =>
    json(route, { conversations: [], turns: [] }),
  );
  await page.route("**/api/kody/system-events", (route) =>
    json(route, { events: [] }),
  );
  await page.route("**/api/kody/guided-flows", (route) =>
    json(route, { flows: [] }),
  );
  await page.route("**/api/kody/file-spaces**", (route) =>
    json(route, {
      spaces: [
        {
          id: "docs",
          title: "Docs",
          slug: "docs",
          rootPath: "docs",
          builtIn: true,
        },
      ],
    }),
  );
  await page.route("**/api/kody/secrets**", (route) =>
    json(
      route,
      new URL(route.request().url()).pathname.endsWith("/FLY_API_TOKEN/value")
        ? { value: null }
        : { secrets: [] },
    ),
  );

  await page.route("https://api.github.com/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const pathname = decodeURIComponent(url.pathname);
    const method = request.method();
    const repoPrefix = `/repos/${OWNER}/${REPO}`;

    if (pathname === repoPrefix && method === "GET") {
      return json(route, { default_branch: "main" });
    }
    if (pathname === `${repoPrefix}/git/ref/heads/main` && method === "GET") {
      return json(route, { object: { sha: "head-1" } });
    }
    if (pathname === `${repoPrefix}/git/commits/head-1` && method === "GET") {
      return json(route, { sha: "head-1", tree: { sha: "tree-1" } });
    }
    if (pathname === `${repoPrefix}/git/trees/tree-1` && method === "GET") {
      return json(route, {
        sha: "tree-1",
        truncated: false,
        tree: [...files.entries()].map(([path, file]) => ({
          path,
          mode: "100644",
          type: "blob",
          sha: file.sha,
          size: Buffer.byteLength(file.content),
        })),
      });
    }
    if (pathname === `${repoPrefix}/git/blobs` && method === "POST") {
      const body = request.postDataJSON() as { content: string };
      const sha = `blob-${sequence++}`;
      blobs.set(sha, body.content);
      return json(route, { sha }, 201);
    }
    if (pathname.startsWith(`${repoPrefix}/git/blobs/`) && method === "GET") {
      const sha = pathname.slice(`${repoPrefix}/git/blobs/`.length);
      const file = [...files.values()].find((entry) => entry.sha === sha);
      if (!file) return json(route, { message: "Not Found" }, 404);
      return json(route, {
        sha,
        encoding: "base64",
        content:
          file.base64Content ??
          Buffer.from(file.content, "utf8").toString("base64"),
        size: file.base64Content
          ? Buffer.from(file.base64Content, "base64").byteLength
          : Buffer.byteLength(file.content),
      });
    }
    if (pathname === `${repoPrefix}/git/trees` && method === "POST") {
      const body = request.postDataJSON() as { tree: GitTreeEntry[] };
      pendingTree = body.tree;
      return json(route, { sha: `tree-${sequence++}` }, 201);
    }
    if (pathname === `${repoPrefix}/git/commits` && method === "POST") {
      return json(route, { sha: `commit-${sequence++}` }, 201);
    }
    if (
      pathname === `${repoPrefix}/git/refs/heads/main` &&
      method === "PATCH"
    ) {
      contentsSnapshotBeforeTreeMutation = new Map(files);
      for (const entry of pendingTree) {
        if (entry.sha === null) {
          files.delete(entry.path);
          continue;
        }
        const existing = [...files.values()].find(
          (file) => file.sha === entry.sha,
        );
        files.set(entry.path, {
          content:
            existing?.content ??
            Buffer.from(blobs.get(entry.sha) ?? "", "base64").toString("utf8"),
          sha: entry.sha,
        });
      }
      pendingTree = [];
      treeMutationVisibleAt =
        Date.now() + (options.treeMutationVisibilityDelayMs ?? 0);
      return json(route, { object: { sha: "head-2" } });
    }

    const contentsPrefix = `${repoPrefix}/contents`;
    if (pathname.startsWith(contentsPrefix)) {
      const path = pathname.slice(contentsPrefix.length).replace(/^\/+/, "");
      const readableFiles =
        method === "GET" &&
        contentsSnapshotBeforeTreeMutation &&
        Date.now() < treeMutationVisibleAt
          ? contentsSnapshotBeforeTreeMutation
          : files;

      if (method === "PUT") {
        if (options.fileWriteDelayMs) {
          await new Promise((resolve) =>
            setTimeout(resolve, options.fileWriteDelayMs),
          );
        }
        const body = request.postDataJSON() as { content: string };
        const sha = `content-${sequence++}`;
        files.set(path, {
          content: Buffer.from(body.content, "base64").toString("utf8"),
          sha,
        });
        return json(
          route,
          { content: { path, sha }, commit: { sha: `commit-${sequence++}` } },
          201,
        );
      }

      if (method === "DELETE" && files.has(path)) {
        files.delete(path);
        return json(route, {
          content: null,
          commit: { sha: `commit-${sequence++}` },
        });
      }

      if (method === "GET" && readableFiles.has(path)) {
        if (options.fileReadDelayMs) {
          await new Promise((resolve) =>
            setTimeout(resolve, options.fileReadDelayMs),
          );
        }
        const file = readableFiles.get(path)!;
        return json(route, {
          type: "file",
          name: path.split("/").pop(),
          path,
          sha: file.sha,
          size: file.base64Content
            ? Buffer.from(file.base64Content, "base64").byteLength
            : Buffer.byteLength(file.content),
          encoding: file.omitContentsPayload ? "none" : "base64",
          content: file.omitContentsPayload
            ? ""
            : (file.base64Content ??
              Buffer.from(file.content).toString("base64")),
        });
      }

      if (method === "GET") {
        if (path === "") rootDirectoryReads += 1;
        if (path === options.failedDirectory) {
          return json(route, { message: "Not Found" }, 404);
        }
        if (
          options.emptyRepository &&
          path === "" &&
          readableFiles.size === 0
        ) {
          return json(route, { message: "This repository is empty." }, 404);
        }
        const prefix = path ? `${path}/` : "";
        const entries = new Map<string, Record<string, unknown>>();
        for (const [filePath, file] of readableFiles) {
          if (!filePath.startsWith(prefix)) continue;
          const remainder = filePath.slice(prefix.length);
          const [name, ...nested] = remainder.split("/");
          if (!name) continue;
          const entryPath = prefix + name;
          entries.set(
            name,
            nested.length > 0
              ? {
                  type: "dir",
                  name,
                  path: entryPath,
                  sha: `dir-${name}`,
                  size: 0,
                }
              : {
                  type: "file",
                  name,
                  path: entryPath,
                  sha: file.sha,
                  size: Buffer.byteLength(file.content),
                },
          );
        }
        if (entries.size > 0 || path === "") {
          return json(route, [...entries.values()]);
        }
        return json(route, { message: "Not Found" }, 404);
      }
    }

    unhandledGitHubRequests.push(`${method} ${pathname}`);
    return json(route, { message: "Not Found" }, 404);
  });

  return {
    files,
    rootDirectoryReads: () => rootDirectoryReads,
    unhandledGitHubRequests,
  };
}

function collectRuntimeFailures(
  page: Page,
  options: {
    emptyRepository?: boolean;
    expectedMissingPaths?: string[];
  } = {},
) {
  const failures: string[] = [];
  const expectedMissingPaths = [
    "e2e-workspace/renamed.txt",
    ...(options.expectedMissingPaths ?? []),
  ];
  const isExpectedMissingPath = (value: string) => {
    const decoded = decodeURIComponent(value);
    return expectedMissingPaths.some((path) =>
      decoded.includes(`/repos/${OWNER}/${REPO}/contents/${path}`),
    );
  };
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    const text = message.text();
    const isExpectedEmptyRepositoryResponse =
      options.emptyRepository &&
      text.includes(
        `GET /repos/${OWNER}/${REPO}/contents - 404 with id UNKNOWN`,
      );
    if (
      message.type() === "error" &&
      !text.startsWith("Failed to load resource:") &&
      !isExpectedMissingPath(text) &&
      !isExpectedEmptyRepositoryResponse
    ) {
      failures.push(text);
    }
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    const isOptionalMonacoWorker =
      url.hostname === "cdn.jsdelivr.net" &&
      url.pathname.includes("/monaco-editor@") &&
      url.pathname.includes("/assets/editor.worker-") &&
      url.pathname.endsWith(".js");
    const isCancelledMachineProbe =
      url.pathname === "/api/kody/chat/machines" &&
      request.failure()?.errorText === "net::ERR_ABORTED";
    const isCancelledEngineProbe =
      url.pathname === "/api/kody/engine/status" &&
      request.failure()?.errorText === "net::ERR_ABORTED";
    const isCancelledDevFont =
      url.pathname.startsWith("/__nextjs_font/") &&
      request.failure()?.errorText === "net::ERR_ABORTED";
    const isCancelledTelemetry =
      url.pathname === "/api/kody/system-events" &&
      request.failure()?.errorText === "net::ERR_ABORTED";
    if (
      isOptionalMonacoWorker ||
      isCancelledMachineProbe ||
      isCancelledEngineProbe ||
      isCancelledDevFont ||
      isCancelledTelemetry
    ) {
      return;
    }
    failures.push(
      `${request.method()} ${request.url()} failed (${request.failure()?.errorText ?? "unknown error"})`,
    );
  });
  page.on("response", (response) => {
    if (response.status() < 400) return;
    const url = response.url();
    const isExpectedExistenceProbe =
      response.status() === 404 && isExpectedMissingPath(url);
    const isExpectedEmptyRepositoryResponse =
      options.emptyRepository &&
      response.status() === 404 &&
      decodeURIComponent(new URL(url).pathname) ===
        `/repos/${OWNER}/${REPO}/contents`;
    const isOptionalAsset =
      response.status() === 404 && new URL(url).pathname === "/favicon.svg";
    if (
      !isExpectedExistenceProbe &&
      !isExpectedEmptyRepositoryResponse &&
      !isOptionalAsset
    ) {
      failures.push(`${response.status()} ${url}`);
    }
  });
  return failures;
}

test.describe("repository file manager", () => {
  test.beforeEach(({}, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "One desktop journey covers the file workspace contract.",
    );
  });

  test("loads Files, Docs, and a file space through the shared workspace", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { unhandledGitHubRequests } = await installFileManagerHarness(page);

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
    await expect(
      page.getByRole("treeitem", { name: "README.md 12 B" }),
    ).toBeVisible();

    await page.goto(`/repo/${OWNER}/${REPO}/docs`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Docs" })).toBeVisible();
    await expect(
      page.getByRole("treeitem", { name: "guide.md 8 B" }),
    ).toBeVisible();

    await page.goto(`/repo/${OWNER}/${REPO}/file-spaces/docs`, {
      waitUntil: "domcontentloaded",
    });
    await expect(page.getByRole("heading", { name: "Docs" })).toBeVisible();
    await expect(
      page.getByRole("treeitem", { name: "guide.md 8 B" }),
    ).toBeVisible();

    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("keeps the code editor in sync with the dashboard theme", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    await page.addInitScript(() => {
      localStorage.setItem("kody-theme", "dark");
    });
    const { unhandledGitHubRequests } = await installFileManagerHarness(page, {
      codeFile: true,
    });

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await page.getByRole("treeitem", { name: /example\.ts/ }).click();

    const editor = page.locator(".monaco-editor").first();
    await expect(editor).toHaveClass(/vs-dark/);

    await page.evaluate(() => {
      document.documentElement.setAttribute("data-theme", "light");
    });

    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(editor).not.toHaveClass(/vs-dark/);
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("refreshes the root and every expanded directory", async ({ page }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { files, rootDirectoryReads, unhandledGitHubRequests } =
      await installFileManagerHarness(page);

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await page.getByRole("treeitem", { name: "docs" }).click();
    await expect(
      page.getByRole("treeitem", { name: "guide.md 8 B" }),
    ).toBeVisible();

    await page.getByRole("treeitem", { name: "notes.md 16 B" }).click();
    files.delete("docs/guide.md");
    files.set("docs/external.md", {
      content: "External change\n",
      sha: "external-change-sha",
    });

    await page.getByRole("button", { name: "Refresh files" }).click();

    await expect(
      page.getByRole("treeitem", { name: "external.md 16 B" }),
    ).toBeVisible();
    await expect(page.getByRole("treeitem", { name: /guide\.md/ })).toHaveCount(
      0,
    );
    expect(rootDirectoryReads()).toBe(2);
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("keeps the tree visible when one folder cannot load", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page, {
      expectedMissingPaths: ["docs"],
    });
    const { unhandledGitHubRequests } = await installFileManagerHarness(page, {
      failedDirectory: "docs",
    });

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await page.getByRole("treeitem", { name: "docs" }).click();

    await expect(
      page.getByText("Could not load docs", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("treeitem", { name: "README.md 12 B" }),
    ).toBeVisible();
    await expect(
      page.getByRole("treeitem", { name: "notes.md 16 B" }),
    ).toBeVisible();
    await expect(page.getByRole("treeitem", { name: "docs" })).toBeVisible();
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("uploads files from the workspace actions menu", async ({ page }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { files, unhandledGitHubRequests } =
      await installFileManagerHarness(page);

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("treeitem", { name: "README.md 12 B" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "More file actions" }).click();
    await page.getByRole("menuitem", { name: "Upload", exact: true }).click();

    await page
      .locator('input[type="file"][aria-label="Choose files to upload"]')
      .setInputFiles({
        name: "uploaded.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("uploaded content\n"),
      });

    await expect
      .poll(() => files.get("uploaded.txt")?.content)
      .toBe("uploaded content\n");
    await expect(
      page.getByRole("treeitem", { name: "uploaded.txt 17 B" }),
    ).toBeVisible();
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("shows immediate progress while a dragged file is uploading", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { files, unhandledGitHubRequests } = await installFileManagerHarness(
      page,
      { fileWriteDelayMs: 2_000 },
    );

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("treeitem", { name: "README.md 12 B" }),
    ).toBeVisible();

    await page.getByTestId("file-workspace-drop-target").evaluate((target) => {
      const transfer = new DataTransfer();
      transfer.items.add(
        new File(["# Dragged\n"], "dragged.md", { type: "text/markdown" }),
      );
      for (const type of ["dragenter", "dragover", "drop"]) {
        target.dispatchEvent(
          new DragEvent(type, {
            bubbles: true,
            cancelable: true,
            dataTransfer: transfer,
          }),
        );
      }
    });

    await expect(
      page.getByRole("status", { name: "Uploading dragged.md" }),
    ).toBeVisible({ timeout: 500 });
    await expect
      .poll(() => files.get("dragged.md")?.content)
      .toBe("# Dragged\n");
    await expect(
      page.getByRole("treeitem", { name: "dragged.md 10 B" }),
    ).toBeVisible();
    await expect(
      page.getByRole("status", { name: "Uploading dragged.md" }),
    ).toHaveCount(0);
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("loads an empty repository and uploads its first file", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page, {
      emptyRepository: true,
    });
    const { files, unhandledGitHubRequests } = await installFileManagerHarness(
      page,
      { emptyRepository: true },
    );

    const rootListingResponse = page.waitForResponse(
      (response) =>
        response.status() === 404 &&
        decodeURIComponent(new URL(response.url()).pathname) ===
          `/repos/${OWNER}/${REPO}/contents`,
    );
    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await rootListingResponse;
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
    await expect(page.getByText("Could not load Repository")).toHaveCount(0);
    await expect(page.getByText("This folder is empty")).toBeVisible();
    await page.getByRole("button", { name: "More file actions" }).click();
    await expect(
      page.getByRole("menuitem", { name: "New file" }),
    ).toBeVisible();
    await page.getByRole("menuitem", { name: "Upload", exact: true }).click();
    await page
      .locator('input[type="file"][aria-label="Choose files to upload"]')
      .setInputFiles({
        name: "first-file.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("first content\n"),
      });

    await expect
      .poll(() => files.get("first-file.txt")?.content)
      .toBe("first content\n");
    await expect(
      page.getByRole("treeitem", { name: "first-file.txt 14 B" }),
    ).toBeVisible();
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("previews a large PNG instead of opening editable text", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { unhandledGitHubRequests } = await installFileManagerHarness(page, {
      fileReadDelayMs: 2_000,
      largeImage: true,
    });

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await page.getByRole("treeitem", { name: "notes.md 16 B" }).click();
    await expect(
      page.getByRole("textbox", { name: "Editor content" }),
    ).toBeVisible();
    await page.getByRole("treeitem", { name: /large-image\.png/ }).click();

    await expect(
      page.getByRole("status", {
        name: "Loading preview of large-image.png",
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("treeitem", { name: /large-image\.png/ }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("textbox", { name: "Editor content" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("img", { name: "Preview of large-image.png" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Editor content" }),
    ).toHaveCount(0);
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("runs HTML as an isolated browser document", async ({ page }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const externalPreviewRequests: string[] = [];
    await page.route("https://preview.invalid/tailwind.js", (route) => {
      externalPreviewRequests.push(route.request().url());
      return route.fulfill({
        contentType: "application/javascript",
        body: 'document.head.insertAdjacentHTML("beforeend","<style>.text-blue-600{color:rgb(37,99,235)}</style>")',
      });
    });
    await page.route("https://preview.invalid/lucide.js", (route) => {
      externalPreviewRequests.push(route.request().url());
      return route.fulfill({
        contentType: "application/javascript",
        body: 'document.addEventListener("DOMContentLoaded",()=>{document.querySelectorAll("[data-lucide]").forEach((icon)=>icon.outerHTML="<svg aria-label=\\"Rendered icon\\"></svg>")})',
      });
    });
    await page.addInitScript(() => {
      Object.assign(window, { __htmlPreviewParentAccess: "unknown" });
      window.addEventListener("message", (event) => {
        if (event.data?.type === "html-preview-parent-access") {
          Object.assign(window, {
            __htmlPreviewParentAccess: event.data.value,
          });
        }
      });
    });
    await installFileManagerHarness(page, { htmlPreview: true });

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await page.getByRole("treeitem", { name: /preview\.html/ }).click();
    await expect(
      page.getByRole("textbox", { name: "Editor content" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "View mode" }).click();

    const preview = page.frameLocator(
      'iframe[title="Preview of preview.html"]',
    );
    await expect(
      preview.getByRole("heading", { name: "HTML preview works" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        preview
          .getByRole("heading")
          .evaluate((heading) => getComputedStyle(heading).color),
      )
      .toBe("rgb(37, 99, 235)");
    await expect(
      preview.getByRole("img", { name: "Rendered icon" }),
    ).toBeVisible();
    await preview.getByRole("button", { name: "Details" }).click();
    await expect(preview.getByText("Interactive details")).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (
              window as typeof window & {
                __htmlPreviewParentAccess: string;
              }
            ).__htmlPreviewParentAccess,
        ),
      )
      .toBe("blocked");
    expect(externalPreviewRequests.sort()).toEqual(
      [
        "https://preview.invalid/lucide.js",
        "https://preview.invalid/tailwind.js",
      ].sort(),
    );
    expect(runtimeFailures).toEqual([]);

    await page.getByRole("button", { name: "Edit mode" }).click();
    await expect(
      page.getByRole("textbox", { name: "Editor content" }),
    ).toBeVisible();
  });

  test("opens an HTML file with spaces from its canonical and legacy URLs", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { unhandledGitHubRequests } = await installFileManagerHarness(page, {
      htmlPreview: true,
    });

    await page.goto(`${REPO_ROUTE}/lesson%2520page.html`, {
      waitUntil: "domcontentloaded",
    });

    await expect(
      page.getByRole("textbox", { name: "Editor content" }),
    ).toBeVisible();
    await expect(page).toHaveURL(`${REPO_ROUTE}/lesson%20page.html`);
    await page.getByRole("button", { name: "View mode" }).click();

    const preview = page.frameLocator(
      'iframe[title="Preview of lesson page.html"]',
    );
    await expect(
      preview.getByRole("heading", {
        name: "Encoded lesson preview works",
      }),
    ).toBeVisible();
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("previews an Office document through the isolated renderer", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { unhandledGitHubRequests } = await installFileManagerHarness(page, {
      officePreview: true,
    });

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await page.getByRole("treeitem", { name: /report\.docx/ }).click();

    await expect(
      page.locator('[aria-label="Preview of report.docx"]'),
    ).toBeVisible();
    await expect(page.getByText("Office preview works")).toBeVisible();
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("previews a spreadsheet through the isolated renderer", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { unhandledGitHubRequests } = await installFileManagerHarness(page, {
      spreadsheetPreview: true,
    });

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await page.getByRole("treeitem", { name: /report\.xlsx/ }).click();

    const preview = page.locator('[aria-label="Preview of report.xlsx"]');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-preview-status", "ready");
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("keeps a text spreadsheet editable and offers a formatted preview", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { unhandledGitHubRequests } = await installFileManagerHarness(page, {
      textSpreadsheetPreview: true,
    });

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await page.getByRole("treeitem", { name: /report\.csv/ }).click();

    await expect(page.getByRole("button", { name: "Edit mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await page.getByRole("button", { name: "View mode" }).click();
    await page.getByRole("button", { name: "Hide file panel" }).click();

    const preview = page.locator('[aria-label="Preview of report.csv"]');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-preview-status", "ready");
    await expect(
      preview.getByText("2 rows, 2 columns, loading smoothly by viewport"),
    ).toBeVisible();

    await page.getByRole("button", { name: "Edit mode" }).click();
    await expect(page.getByRole("button", { name: "Edit mode" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("previews a PowerPoint deck through the isolated renderer", async ({
    page,
  }) => {
    const { unhandledGitHubRequests } = await installFileManagerHarness(page, {
      presentationPreview: true,
    });

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("treeitem", { name: /slides\.pptx/ }),
    ).toBeVisible();
    const runtimeFailures = collectRuntimeFailures(page);
    await page.getByRole("treeitem", { name: /slides\.pptx/ }).click();

    const preview = page.locator('[aria-label="Preview of slides.pptx"]');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-preview-status", "ready");
    await expect(preview.getByText("PPTX preview works")).toBeVisible();
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("previews a ZIP archive without enabling other archive formats", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { unhandledGitHubRequests } = await installFileManagerHarness(page, {
      zipPreview: true,
    });

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await page.getByRole("treeitem", { name: /bundle\.zip/ }).click();

    const preview = page.locator('[aria-label="Preview of bundle.zip"]');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("data-preview-status", "ready");
    await expect(
      preview.getByRole("button", { name: /hello\.txt/ }),
    ).toBeVisible();
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("uploads any repository file type inside a scoped file workspace", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { files, unhandledGitHubRequests } =
      await installFileManagerHarness(page);

    await page.goto(`/repo/${OWNER}/${REPO}/file-spaces/docs`, {
      waitUntil: "domcontentloaded",
    });
    await expect(
      page.getByRole("treeitem", { name: "guide.md 8 B" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "More file actions" }).click();
    await page.getByRole("menuitem", { name: "Upload", exact: true }).click();
    await page
      .locator('input[type="file"][aria-label="Choose files to upload"]')
      .setInputFiles({
        name: "cover.txt",
        mimeType: "text/plain",
        buffer: Buffer.from("post media companion\n"),
      });

    await expect
      .poll(() => files.get("docs/cover.txt")?.content)
      .toBe("post media companion\n");
    await expect(
      page.getByRole("treeitem", { name: "cover.txt 21 B" }),
    ).toBeVisible();
    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("saves an edited file immediately with an automatic commit message", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { files, unhandledGitHubRequests } =
      await installFileManagerHarness(page);

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await page.getByRole("treeitem", { name: "notes.md 16 B" }).click();

    await expect(page.getByRole("button", { name: "Bold" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Mermaid diagram" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Edit mode" }),
    ).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "View mode" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Split mode" })).toHaveCount(
      0,
    );
    const editor = page.getByRole("textbox", { name: "Editor content" });
    await editor.click({ force: true });
    await editor.press("ControlOrMeta+A");
    await editor.press("Backspace");
    await page.keyboard.insertText("Updated notes\n");
    await page.getByRole("button", { name: "View mode" }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Bold" })).toHaveCount(0);
    await expect(
      page.getByText("Updated notes", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByText("Updated notes", { exact: true })
          .evaluate((element) => getComputedStyle(element).fontSize),
      )
      .toBe("16px");
    await page.getByRole("button", { name: "Edit mode" }).click();
    await expect(editor).toHaveValue("Updated notes\n");

    const saveRequestPromise = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        decodeURIComponent(new URL(request.url()).pathname).endsWith(
          `/repos/${OWNER}/${REPO}/contents/notes.md`,
        ),
    );
    await page.getByRole("button", { name: "Save changes" }).click();

    await expect(
      page.getByRole("dialog", { name: "Save changes" }),
    ).toHaveCount(0);
    const saveRequest = await saveRequestPromise;
    expect(saveRequest.postDataJSON()).toMatchObject({
      message: "chore: update notes.md",
    });
    await expect
      .poll(() => files.get("notes.md")?.content)
      .toContain("Updated notes");
    await expect(page.getByText("Unsaved", { exact: true })).toHaveCount(0);

    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("creates, renames, and deletes repository items", async ({ page }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { files, unhandledGitHubRequests } =
      await installFileManagerHarness(page);

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: "Files" })).toBeVisible();
    await expect(
      page.getByRole("treeitem", { name: "README.md 12 B" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "More file actions" }).click();
    const newFolderAction = page.getByRole("menuitem", { name: "New folder" });
    await expect(newFolderAction).toBeVisible();
    await newFolderAction.click();
    const folderDialog = page.getByRole("dialog", { name: "New folder" });
    await folderDialog
      .getByPlaceholder("folder-name or nested/path")
      .fill("e2e-workspace");
    await folderDialog.getByRole("button", { name: "Create" }).click();
    await expect.poll(() => files.has("e2e-workspace/.gitkeep")).toBe(true);
    await expect(page).toHaveURL(/\/files\/e2e-workspace$/);
    await expect(page.getByText("Current space")).toBeVisible();

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(
      page.getByRole("treeitem", { name: "README.md 12 B" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "More file actions" }).click();
    const newFileAction = page.getByRole("menuitem", { name: "New file" });
    await expect(newFileAction).toBeVisible();
    await newFileAction.click();
    const fileDialog = page.getByRole("dialog", { name: "New file" });
    await fileDialog
      .getByPlaceholder("filename.txt or nested/path.txt")
      .fill("draft.txt");
    await fileDialog.getByRole("button", { name: "Create" }).click();
    await expect.poll(() => files.has("draft.txt")).toBe(true);
    await expect(page).toHaveURL(/\/files\/draft\.txt$/);

    await page.getByRole("button", { name: "More file actions" }).click();
    await page.getByRole("menuitem", { name: "Rename or move" }).click();
    const moveDialog = page.getByRole("dialog", { name: "Rename or move" });
    await moveDialog.getByRole("textbox").fill("e2e-workspace/renamed.txt");
    await moveDialog.getByRole("button", { name: "Move" }).click();
    await expect
      .poll(() => ({
        oldPath: files.has("draft.txt"),
        newPath: files.has("e2e-workspace/renamed.txt"),
        unhandledGitHubRequests,
      }))
      .toEqual({
        oldPath: false,
        newPath: true,
        unhandledGitHubRequests: [],
      });

    await page.getByRole("button", { name: "More file actions" }).click();
    await page.getByRole("menuitem", { name: "Delete" }).click();
    const deleteDialog = page.getByRole("dialog", { name: "Delete file" });
    await deleteDialog.getByRole("button", { name: "Delete" }).click();
    await expect.poll(() => files.has("e2e-workspace/renamed.txt")).toBe(false);
    await expect(
      page.getByText("Choose what you want to work on"),
    ).toBeVisible();
    expect(runtimeFailures).toEqual([]);
  });

  test("keeps a moved file visible while GitHub listings catch up", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page, {
      expectedMissingPaths: ["docs/notes.md"],
    });
    const { files, unhandledGitHubRequests } = await installFileManagerHarness(
      page,
      {
        treeMutationVisibilityDelayMs: 5_000,
      },
    );

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    const docsFolder = page.getByRole("treeitem", { name: "docs" });
    await docsFolder.click();
    await expect(
      page.getByRole("treeitem", { name: "guide.md 8 B" }),
    ).toBeVisible();

    await page
      .getByRole("treeitem", { name: "notes.md 16 B" })
      .dragTo(docsFolder);
    await expect.poll(() => files.has("docs/notes.md")).toBe(true);
    await expect(files.has("notes.md")).toBe(false);

    await expect(
      page.getByRole("treeitem").filter({ hasText: "notes.md" }),
    ).toBeVisible({ timeout: 1_000 });
    await page.getByRole("button", { name: "Refresh files" }).click();
    await expect(
      page.getByRole("treeitem").filter({ hasText: "notes.md" }),
    ).toBeVisible();

    expect(unhandledGitHubRequests).toEqual([]);
    expect(runtimeFailures).toEqual([]);
  });

  test("restores an unsaved local draft after reload", async ({ page }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    await installFileManagerHarness(page);

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await page.getByRole("treeitem", { name: "notes.md 16 B" }).click();

    const editor = page.getByRole("textbox", { name: "Editor content" });
    await editor.click({ force: true });
    await editor.press("ControlOrMeta+A");
    await editor.press("Backspace");
    await editor.type("Unsaved browser draft");
    await expect(
      page.getByRole("button", { name: "Save changes" }),
    ).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(
          (key) => localStorage.getItem(key),
          `kody:file-draft:${OWNER}/${REPO}/notes.md`,
        ),
      )
      .toContain("Unsaved browser draft");

    await page.evaluate(() => document.fonts.ready);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("treeitem", { name: "notes.md 16 B" }).click();
    await expect(
      page.getByRole("textbox", { name: "Editor content" }),
    ).toHaveValue("Unsaved browser draft");
    expect(runtimeFailures).toEqual([]);
  });

  test("keeps a file in place while its contents load", async ({ page }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    await installFileManagerHarness(page, { fileReadDelayMs: 3_000 });

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    const treeItems = page.getByRole("treeitem");
    await expect(treeItems).toHaveCount(3);
    await expect(treeItems.nth(0)).toContainText("docs");
    await expect(treeItems.nth(1)).toContainText("notes.md");
    await expect(treeItems.nth(2)).toContainText("README.md");

    await page.evaluate(() => {
      const snapshots: Array<Array<{ text: string; expanded: string | null }>> =
        [];
      const capture = () => {
        snapshots.push(
          [...document.querySelectorAll('[role="treeitem"]')].map((item) => ({
            text: item.textContent?.trim() ?? "",
            expanded: item.getAttribute("aria-expanded"),
          })),
        );
      };
      capture();
      new MutationObserver(capture).observe(document.body, {
        attributes: true,
        childList: true,
        subtree: true,
      });
      Object.assign(window, { __fileTreeSnapshots: snapshots });
    });

    const notes = page.getByRole("treeitem", { name: "notes.md 16 B" });
    await notes.click();
    await expect(page).toHaveURL(/\/files\/notes\.md$/);
    await expect(
      page.getByRole("textbox", { name: "Editor content" }),
    ).toBeVisible({ timeout: 10_000 });

    const loadingSnapshots = await page.evaluate(
      () =>
        (
          window as typeof window & {
            __fileTreeSnapshots: Array<
              Array<{ text: string; expanded: string | null }>
            >;
          }
        ).__fileTreeSnapshots,
    );
    const stableLabels = ["docs", "notes.md", "README.md"];
    expect(loadingSnapshots).not.toEqual([]);
    expect(
      loadingSnapshots.every(
        (snapshot) =>
          JSON.stringify(
            snapshot.map(({ text }) => text.replace(/\d+ B$/, "")),
          ) === JSON.stringify(stableLabels),
      ),
    ).toBe(true);
    expect(runtimeFailures).toEqual([]);
  });

  test("keeps repository navigation mounted while selecting folders and files", async ({
    page,
  }) => {
    const runtimeFailures = collectRuntimeFailures(page);
    const { rootDirectoryReads } = await installFileManagerHarness(page);

    await page.goto(REPO_ROUTE, { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("treeitem")).toHaveCount(3);
    expect(rootDirectoryReads()).toBe(1);

    await page.getByRole("treeitem", { name: "docs" }).click();
    await expect(page).toHaveURL(/\/files\/docs$/);
    await expect(page.getByRole("heading", { name: "docs" })).toBeVisible();
    expect(rootDirectoryReads()).toBe(1);

    await page.getByRole("treeitem", { name: "notes.md 16 B" }).click();
    await expect(page).toHaveURL(/\/files\/notes\.md$/);
    await expect(
      page.getByRole("textbox", { name: "Editor content" }),
    ).toBeVisible();
    expect(rootDirectoryReads()).toBe(1);

    await page.goBack();
    await expect(page).toHaveURL(/\/files\/docs$/);
    await expect(page.getByRole("heading", { name: "docs" })).toBeVisible();
    expect(rootDirectoryReads()).toBe(1);

    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`${REPO_ROUTE}/?$`));
    await expect(
      page.getByText("Choose what you want to work on"),
    ).toBeVisible();
    expect(rootDirectoryReads()).toBe(1);
    expect(runtimeFailures).toEqual([]);
  });
});
