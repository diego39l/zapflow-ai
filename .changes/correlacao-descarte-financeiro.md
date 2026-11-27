---
impacto: nada_mudou
secao: corrigido
titulo: Exclusão de lançamento usa o mesmo identificador na resposta e na auditoria
---

O cabeçalho X-Request-Id do descarte de um lançamento pela API do aplicativo coincide com o identificador gravado na auditoria da operação. O servidor gera esse valor ao receber a requisição.
